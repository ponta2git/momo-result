# 戦績分析バッチ 要求仕様

目的: 戦績比較、振り返り、drilldown、試合文脈に必要な計算を HTTP request から分離し、作品単位の非同期処理として安全に公開するための横断要求を定義する。

正本の境界:

| 関心事 | 正本 |
| --- | --- |
| 利用者体験、scope、指標の意味 | `docs/requirements/series-comparison.md` |
| 行動仮説の生成・選定・表現 | `docs/requirements/series-review-playbook.md` |
| job、artifact、version、公開・復旧 | 本書 |
| runtime / parent-child | `docs/architecture.md` |
| DB / migration | `docs/db-rule.md` と `../momo-db` |
| artifact / queue / HTTP shape | JSON Schema、共有fixture、Tapir endpoint、`apps/api/openapi.yaml` |
| UI / test / command | `docs/ui-rule.md`、`docs/test-rule.md`、`docs/dev-rule.md` |

本書は指標の数式、推薦候補、画面構成、wire fieldを複製しない。

artifact resourceのJSON本文は共有fixtureとproducer / reader validatorを正本とする。Tapir / OpenAPIはHTTP envelopeと取得経路を表し、raw JSON本文の全ネストを代替しない。

provider固有値、費用、実測、昇格・復旧手順は public docs へ置かず、private release evidence / runbook を正本とする。

## 1. Core Decisions

- 通常集計、振り返り、高度分析、drilldown、試合文脈は作品単位で事前計算し、API は保存済み成果物だけを読む。同期 fallback を持たない。
- production の分析計算は Rust に統一し、Scala engine を HTTP / worker runtimeへ戻さない。
- 1 job は1作品の全有効 scope と全表示用途を同じ入力 snapshot から計算し、作品単位で原子的に公開する。
- DB を revision、request、job、attempt、slot、outbox、artifact、公開状態の正本とし、Redis Streams は少なくとも1回の配送路に限定する。
- 全 runtime を通じた分析実行枠は1件とし、DB lease と単調増加 fence で保証する。
- OCR 同居時も共有枠は1件とする。OCRだけが分析を preempt でき、分析はOCRをpreemptしない。
- resource上限、timeout、reader / worker / schema互換性が検証されるまで publication を fail closed にする。

## 2. Version / Recalculation Intent

| Version | 意味 |
| --- | --- |
| input revision | 作品の確定済み分析入力。作品単位で単調増加する |
| algorithm version | 数式、特徴量、seed、閾値、候補選択など結果の意味 |
| artifact schema version | 保存成果物の構造とreader互換性 |
| HTTP wire version | clientへ返すAPI契約。artifact schemaと独立 |

文字列や timestamp の偶然の大小で version を比較しない。成果物、request、job は必要な version 組を明示する。

### Automatic Triggers

- 試合確定、確定済み試合の更新・削除は、影響作品の input revision と再計算 intent を同じ transaction で進める。
- 作品 A から B へ移る更新は、変更前後の確定済み集合の和集合を対象とする。
- 計算入力へ影響する master 変更は revision を進め、計算意味も変わる場合は algorithm version も進める。表示名・localeなど表示専用 metadata はAPIでhydrateし、revisionへ含めない。
- algorithm / artifact schema 更新は受理時点の全登録作品、初回 backfill は確定試合を持つ作品を永続 snapshot する。
- snapshot 展開は再開可能かつ冪等にし、途中停止で対象を失わない。snapshot 後の新規対象は通常 trigger で扱う。

### Manual Triggers

- 管理者は1作品または全作品の再計算を、認証、CSRF、`Idempotency-Key` 付きで要求できる。
- HTTP operation の監査・冪等性と、作品単位へ集約する work intent を分ける。同じ key は同じ operation、異なる key は別 operation とする。
- 全作品操作は受理時点の target snapshot と campaign を保存し、作品別 request へ非同期展開する。巨大な同期 response を返さない。
- 手動 run は current artifact が最新でも、受理後に開始する実計算を最低1回保証する。active attempt 開始後の要求を、その attempt で充足したことにしない。
- 複数要求は未充足の次runへ集約できるが、要求者、受理時刻、operationとの対応を失わない。
- 同じ version 組の再計算は、source input checksum と semantic checksum が一致すれば既存 artifact を再利用できる。sourceだけが違えば revision 更新漏れ、出力だけが違えば非決定性として失敗し、currentを維持する。

## 3. Job / Delivery

| 状態 | 意味 |
| --- | --- |
| `queued` | 実行待ち、supersede / preemption / graceful停止後の再実行待ち |
| `running` | DB lease / fence を持つ attempt が実行中 |
| `succeeded` | 対象 version の成果物を公開済み |
| `failed` | 非再試行失敗、または retry / lease recovery 上限 |
| `timed_out` | hard timeout |

- queued 中の新 revision は最新版へ集約する。running 中の新 revision は古い candidate を公開せず、次runへ戻す。
- 一時的な DB / queue 障害だけを最大3回自動 retry する。timeout、入力契約違反、決定論的失敗は retry しない。
- lease recovery は計算 retry と別に有界化する。supersede、preemption、graceful停止を失敗回数へ含めない。
- worker は対応する algorithm / artifact schema version の job だけを claim する。非対応 job を terminal 化せず、compatible workerへ再配送可能な `queued` に保つ。
- queue payload は version と opaque job ID だけを運び、業務状態を信用しない。厳密なshapeはqueue schemaを正本とする。
- work と outbox は同じ transaction で確定し、commit 後にだけ typed wake を送る。wake はcoalescing hintであり、durable outboxの代わりにしない。
- dispatcher は startup、wake、retry / semantic deadline、低頻度 recovery を待って bounded drain する。固定短周期 polling と rowごとの timer を作らない。
- Redis append と outbox delivery確定の両方が成功して配送完了とする。append後のDB失敗や重複 delivery はDB claimで収束させる。
- terminal DB write と必要な次outboxを確定してから ACK する。commit成否不明時はDBを再読し、結果を推測しない。
- stale PEL は bounded recovery と新規 delivery の公平性を保つ。shared slot busyやunsupported versionで delivery を失わない。

## 4. Execution / Publication

- attempt開始は execution slot、title state、job、version capability を同じDB整合性境界で確認し、slotとjobへ同じowner / fence / leaseを保存する。
- heartbeat、terminal遷移、publication、slot解放はowner / job / attempt / fence / lease / target versionの一致を必須にする。stale ownerは正しいcandidateでも公開できない。
- leaseはDB clock、process timeoutはmonotonic clockで判断する。lease維持不能を検知したparentはchildを停止しpublicationしない。
- OCR preempt intentはDBへ保存する。分析childを回収しjobを `queued` へ戻してslotを解放した後にOCRを開始する。publicationの短いcommit区間はpreemptしない。
- childはread-onlyで一貫した入力を読み、boundedで非authoritativeなcandidate / manifestだけを返す。外部I/O、ACK、outbox、current pointerを変更しない。
- parentはpath、schema、件数、byte数、深さ、checksum、参照整合性を検証し、失敗・timeout・preemption・owner喪失で部分公開しない。
- 大容量 staging と短い fenced publication を分ける。stagingはcurrentから不可視とし、fresh transactionで完全性と実行権を再検証してからcurrent / previousを切り替える。
- publication失敗やcommit成否不明はcurrentを維持し、fresh connection上の永続状態から再開する。

DB lock順とstaging transactionの規則は `docs/db-rule.md`、process責務は `docs/architecture.md` を正本とする。

## 5. Artifact Contract

- 1作品の成果物はoverallと、確定試合が実在するseason、map、season×mapだけを含む。空の直積scopeを作らない。
- aggregate、review、drilldown、match contextは同じ入力から計算し、高負荷な中間結果を再利用する。
- match contextは対象試合revisionと作品所属を保存する。読み取り時に一致しなければ古い派生分析を返さない。
- artifact / manifest / chunkのshapeと上限はJSON Schema、normal / invalid / canonicalization fixtureを正本とする。
- source input checksumは表示専用metadataを除く入力を決定順にhashし、semantic checksumはresource / scope / item / canonical payloadを決定順にhashする。run ID、日時、表示名、処理時間を含めない。
- canonicalization規則の変更はartifact schema version変更として扱い、producer / validator / readerの共有fixtureを同時更新する。
- 非有限値、負の0、overflow、欠損cell、重複ID、未決定順を拒否する。対象なし、分母0、件数不足、定義済みmodel非採用はtyped qualityを持つ正常成果物とする。
- artifactはstable IDと意味code、権威ある配列順を持つ。可変表示名はAPIでhydrateし、API / Webで意味値や順序を再計算しない。
- manifestをchunk allowlistとし、path逸脱、symlink、未宣言・欠損file、checksum不一致を拒否する。attempt directoryは全終了経路とstartup recoveryでcleanupする。
- 各resourceはencoded / decoded bytes、件数、深さの上限を持ち、上限超過artifactを公開しない。

各作品はcurrentとpreviousの成功artifactを保持する。terminal jobは終了後45日保持し、`queued` / `running` を履歴cleanupしない。管理画面の直近3件という表示上限をDB保持条件に使わない。

## 6. API / Web / Admin

### Read API

- options、status、aggregate、review、drilldown、match contextは保存済み状態 / artifactだけを読む。
- statusはdesired version、current artifact、active / pending work、最後のterminal runからfreshnessと表示可能artifact IDを返す。
- artifact endpointはstatusで解決したartifact IDを必須入力とし、1画面の全resourceを同じartifactへpinする。
- current / previousとして読取可能かの確認と、要求された1 resource / scopeのbounded chunk取得を同じread snapshotで行う。作品全体をdecodeしない。
- artifact schemaとHTTP wire schemaを分け、reader decoderのallowlistと上限を満たさないartifactはfail closedにする。
- optionsは全登録作品を返し、scope候補は現在の確定試合に実在する値だけを返す。確定試合0件と登録作品0件を区別する。
- current / previousでなくなったartifactは明示的なexpired errorとし、Webはstatus更新後に1回だけ最新artifactでretryする。同期計算や別scopeへのfallbackをしない。
- public statusはjob ID、account、attempt数、内部診断を返さない。safe failure codeや要求者はadmin履歴に限定する。

### Web State

- Webはlocale、label、semantic token、描画geometry、URL / selectionだけを扱い、集計、閾値、候補採否、意味順、統計fallbackを再計算しない。
- `queued` / `running` で成功artifactがあれば旧表示と最終成功日時を維持し、更新または手動再計算中であることを区別する。
- 初回計算中は分析値のないloading state、成果物なしの失敗は分析値のないerror stateを出す。失敗時も旧成功artifactがあれば維持する。
- preemptionは失敗として表示せず `queued` と同じ扱いにする。対象match revision不一致では一次データを維持し、分析文脈だけを隠す。
- active状態だけをbounded intervalでpollし、terminal / 非表示時は停止する。新artifact取得中は旧表示を保ち、latest resultだけへ原子的に切り替える。
- artifact切替時に古いdrilldown / match contextを混在させない。ancillary resource failureで主表示の切替を無期限に待たない。

### Admin

- 管理画面は1作品runを主操作、全作品runを明示的な確認付き操作とする。一般利用者へ管理導線を出さない。
- 作品候補は確定試合0件を含む全登録作品とし、登録作品0件では操作を拒否する。
- overviewは選択作品のstatus、未充足手動run、slot / queue / campaign要約、全作品横断の直近3件を表示する。
- 履歴は作品、状態、要求元、時刻、処理時間、version、attempt / recovery、safe failure codeを安全な範囲で示す。内部例外、接続先、artifact本文を返さない。

## 7. Correctness / Resource / OCR

- 文書化した数式、分母、同値、seed、境界を正本とし、同じ入力とalgorithm versionから同じ結果を生成する。
- Scalaとの差異は高精度参照、手計算可能なgolden、propertyのいずれかで証明する。意図しない順序・丸め・seed差は不具合とし、意味変更はalgorithm versionを進める。
- 性能fixtureは固定4名、全有効scope、現在データ量の2倍かつ最低500試合/作品を満たし、連続100回でOOM、runtime再起動、memory増加傾向を起こさない。
- worker / child、API decode / response、browser parse / renderを別々に測る。機能test、health、配置成功をresource / performanceの証拠にしない。
- childのhard memory limit超過時もparentが生存してterminal failureを保存できることを実runtimeで証明する。
- artifact / response / temporary storageにbyte、件数、深さ、disk、concurrency上限を設ける。production timeoutは同等runtimeの通常・上限・cold・連続実行測定後に設定する。
- job / queue / phase / memory / byte数を低cardinality metricと安全なstructured logで観測する。実測値とalert thresholdはprivateに置く。

OCR同居を有効化する場合は、共通parent-child境界、単一slot、一方向preemption、子process回収、非authoritative candidateを維持する。OCR payloadは共有storageのopaque keyを使い、local volume共有や一時HTTP配信へ依存しない。activationはversion固定datasetの項目別精度、native依存、object storage、process isolation、resourceを実runtimeで確認して判断する。

## 8. Compatibility / Release / Rollback

- DB migrationはadditiveに進め、reader-firstで新artifact schemaを読めるAPIを先に配置する。readerとworker capability確認後にdesired version / campaignを進める。
- 計画保守で全reader / workerを停止し、公開再開前に全作品を再計算できる場合に限り、単一世代の一括切替を選べる。この場合は旧・新schemaの同時decodeを要求せず、停止確認、復元可能なDB snapshot、旧immutable release、全runtimeの新version一致、全作品の再計算完了を再開条件にする。
- 新HTTP wireはOpenAPIと生成型を同時更新する。旧clientは明示的なreload-requiredへ縮退し、旧同期engineへfallbackしない。
- artifactからwireへのprojectionはrename、enum mapping、metadata hydrateに限定し、旧artifactにない意味値を再計算しない。
- rollbackはcurrent artifact、request、campaign、job、outboxを維持する。旧workerがdesired versionを非対応ならjobを `queued` に保ち、旧algorithmへ黙って戻さない。
- DB down migrationでrevision / job / artifactを削除せず、publication停止中もcurrent artifactを読める状態を維持する。
- 単一世代の保守切替を切り戻す場合は、サービスを停止したままDB snapshotと旧immutable releaseを同じ世代へ戻す。新旧のdesired version、job、artifactを部分的に組み合わせた状態では再開しない。
- release候補はmigration、reader / worker compatibility、immutable provenance、resource hard limit、timeout、artifact / API上限を確認してから昇格する。

## 9. Acceptance Evidence

| 変更領域 | 必要な証拠 |
| --- | --- |
| revision / trigger / campaign | 同一transaction、A→B移動、同時mutation、target snapshot、idempotency、crash recovery |
| job / queue / outbox | coalescing、unsupported version、duplicate delivery、append後DB失敗、terminal write before ACK、retry上限 |
| slot / lease / child / preemption | 複数worker、stale fence、owner喪失、timeout、OOM、process group回収、一方向preemption |
| calculation / artifact | golden、高精度参照、property、canonical fixture、上限、部分公開拒否、current維持 |
| API / Web | bounded read、artifact pinning、expired retry、revision mismatch、状態decision table、意味再計算禁止 |
| admin / retention | auth / CSRF / idempotency、target snapshot、未充足run、直近3件、45日cleanup |
| compatibility / release | reader-first、または停止を伴う単一世代切替の再開条件、version capability、reload導線、rollback後current維持、旧engine不在 |
| resource | 上限fixture、本番同等runtime、worker / API / browser別測定、timeout設定、private evidence |

外部DB、Redis、Linux process、browser、resource gateをskipした場合、その境界は未検証として報告する。完了前に `docs/post-mortem/lessons.md` の該当カードを確認する。
