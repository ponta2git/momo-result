# 戦績分析バッチ 実現仕様

目的: `docs/requirements/series-analysis-batch.md` の要求を、Processing Worker runtime、DB、queue、API、Web、
管理画面をまたぐ実装可能な契約へ落とす。

## AI作業導線

この文書は、戦績分析に固有の横断不変条件を所有する。数式、DDL、payload / HTTP型、個別コマンドの写しを
正本にしない。変更前に次の行で必要な読解経路を確定する。

| 項目 | 到達先 / 判断 |
| --- | --- |
| 第一読 | Analysis capability / worker role / job / artifact / 分析API / 分析画面の実装を変えるときに読む。 |
| この文書だけで決めること | revisionからartifact pinningまでをまたぐ不変条件、Web計算境界、version / rollbackの安全な縮退。 |
| 常に併読 | `docs/requirements/series-analysis-batch.md`、`docs/test-rule.md`、`docs/dev-rule.md`。要求、oracle、実行gateを分けて確認する。 |
| 条件付き併読 | DBは `docs/db-rule.md`、構成は `docs/architecture.md`、UIは `docs/ui-rule.md`、指標・reviewは該当要求。 |
| 実行正本 | `docs/schemas/series-analysis-*.schema.json`、fixture、Tapir endpoint / `apps/api/openapi.yaml`、`apps/processing-worker/`、Web source / checker。 |
| 検証先 | 本書8章から `docs/test-rule.md` と `docs/dev-rule.md` のanalysis / Web / DB gateへ進む。 |

### 変更別の読解経路

| 変更 | 必読 | 条件付き | 実行正本 | 検証先 |
| --- | --- | --- | --- | --- |
| job / request / outbox / lease | 本書の2〜3章、`docs/db-rule.md`, `docs/test-rule.md`, `docs/dev-rule.md` | API構成は `docs/architecture.md` | `../momo-db` migration、`apps/processing-worker/`、queue JSON Schema | DB / Redis integration、control-plane smoke |
| 分析kernel / artifact | 本書の4章、`docs/requirements/series-analysis-batch.md`, `docs/test-rule.md` | 指標・reviewは該当要求 | artifact JSON Schema、canonical fixture、`apps/processing-worker/crates/analysis-core/` | pure / property / cross-language contract test |
| 読み取りAPI / admin API | 本書の5章、`docs/test-rule.md`, `docs/dev-rule.md` | DBは `docs/db-rule.md`、UIは6章 | Tapir endpoint、`apps/api/openapi.yaml`、artifact JSON Schema | OpenAPI / API / DB-backed test |
| 戦績比較画面 / match context | 本書の5〜6章、`docs/ui-rule.md`, `docs/test-rule.md` | UI方向・文言・指標は該当要求 | Web source、generated API型、`apps/web/scripts/check-architecture-imports.mjs` | component / Playwright / UI checker |
| schema / version / release | 本書の4・7章、`docs/requirements/series-analysis-batch.md`, `docs/test-rule.md`, `docs/dev-rule.md` | DB migrationは `docs/db-rule.md` | `docs/schemas/series-analysis-*.schema.json`、fixture、reader / worker capability | compatibility / control-plane / resource gate |

### 正本の境界

- 非同期処理の目的、完了条件、数値の正確性、利用者・管理者の要求は
  `docs/requirements/series-analysis-batch.md` を正とする。
- 指標と数式は `docs/requirements/series-comparison.md`、振り返りの意味は
  `docs/requirements/series-review-playbook.md` を正とする。
- DBの物理DDLとmigrationは `../momo-db`、DB consumerの規則は `docs/db-rule.md` を正とする。
- artifact / queue payloadの厳密なshapeは `docs/schemas/series-analysis-*.schema.json` と
  `docs/schemas/fixtures/series-analysis/`、HTTPの現在のshapeはTapir endpointと
  `apps/api/openapi.yaml` を正とする。
- UIの意味表現と操作不変条件は `docs/ui-rule.md`、テスト選択は `docs/test-rule.md`、実行コマンドは
  `docs/dev-rule.md` を正とする。
- provider固有の構成値、費用、実測値、個別障害、具体的な昇格・復旧手順はpublic文書へ置かない。

## 1. 全体責務と横断不変条件

分析経路は、確定試合の変更から入力revision、durableなwork、outbox配送、worker execution、成果物公開、
artifactを固定したread、Web表示へ一方向に進む。HTTP request内で分析を実行する同期fallbackは持たない。

| 境界 | 所有する責務 | 持たせない責務 |
| --- | --- | --- |
| Web | URL、選択、locale整形、描画geometry、状態表示 | 集計、閾値、候補採否、意味順、統計fallback |
| Scala API | 認証、入力検証、artifactのbounded read、pinning、Problem Details、admin mutation | 分析、推薦、結果補完、統計fallback |
| Processing parent process / Analysis Worker role | delivery、lease / slot / fence、timeout、preemption、子process回収、publication、post-commit effect | 指標計算、巨大成果物の一括保持 |
| Analysis attempt child | read-only snapshot、純粋計算、bounded candidate / manifest生成 | DB pointer更新、Redis ACK、outbox、任意pathへの書込み |
| PostgreSQL | revision、request、job、attempt、slot、outbox、artifact、current / previous pointerの正本 | runtimeの生存推測 |
| Redis Streams | 少なくとも1回の配送、pending recovery | job状態、retry回数、入力・成果物の正本 |

`Processing Worker runtime`、`Analysis Worker role`、長寿命consumer、1回だけ実行するattempt childの用語と
process境界は `docs/architecture.md` 5.1を正とする。Analysis Worker roleは親process内の論理担当であり、
attempt childそのものではない。

### 横断不変条件

1. 初回リリースを含む本番分析経路はRustだけで実装する。Scala分析engineをHTTPやproduction workerから
   再導入しない。
2. 1 jobは1作品の全有効scope、aggregate、review、drilldown、match contextを一貫した入力から計算する。
   1 scopeだけの予期しない失敗で部分公開しない。
3. DBが入力revision、work、job、outbox、artifact、公開状態の正本である。Redisとprocess内状態は失われても
   DBから回復できなければならない。
4. 全runtimeを通じて有効な分析attemptはDB execution slotのholder 1件だけである。process内semaphore、
   Redis consumer数、runtime台数で代用しない。
5. OCRだけが分析をpreemptできる。分析はOCRをpreemptせず、preemptionは失敗・計算retryとして数えない。
6. childの結果は非authoritativeである。lease、owner、attempt、fencing token、target versionを確認する
   publication transactionだけがcurrent pointerを変更できる。
7. 現行artifactは成功した新artifactへ原子的に切り替えるまで維持する。失敗、timeout、preemption、
   staging破損、lease喪失で上書きしない。
8. APIとWebは同じartifact IDにpinする。resourceごとにcurrent artifactを引き直したり、異なるversionを
   同一画面へ混在させたりしない。
9. Webは意味を持つ計算を行わない。欠損値を静かに補完せず、schema / readエラーとして安全に表示する。
10. reader、worker、schemaの互換性が確認できない状態で新versionを公開・campaign開始しない。旧clientは
    明示的なreload導線へ縮退し、旧同期経路へ戻さない。
11. リソース上限は設定され、同等runtimeで検証されるまでpublicationをfail closedにする。値と実測証跡は
    privateに置く。

## 2. 入力revisionとdurable work

### 2.1 影響作品とversion

試合mutationでは、変更前後の「確定済みデータ集合へ含まれる作品」の和集合を影響作品とする。

| 変更 | revisionを進める作品 |
| --- | --- |
| 下書きを作品Aの確定試合にする | A |
| 作品Aの確定試合を同じ作品内で更新する | A |
| 作品Aの確定試合を作品Bへ移す | A、B |
| 作品Aの確定試合を非確定へ戻す、または削除する | A |
| 非確定データだけを更新する | なし |

- 影響作品ごとに単調増加する`inputRevision`を採番し、requestとqueue outboxを試合mutationと同じ
  transactionへ書く。timestampや最大更新日時をconcurrency tokenの代用にしない。
- 確定match本体、player結果、事件、開催・season・map所属、計算集合や数式入力へ影響するmaster変更は、
  同じ変更でrevisionを進める。意味が変わる場合はalgorithm versionも進める。
- 表示名、作品名、locale、Web layoutのような表示専用metadataはrevisionを進めず、APIが現在のmasterから
  hydrateする。未列挙のmaster変更を暗黙に表示専用とみなさない。
- `inputRevision`、`algorithmVersion`、`artifactSchemaVersion`は別のversionである。成果物とrequestはこの
  3つの組で比較する。

### 2.2 永続状態の責務

物理DDLは `../momo-db` を正とする。実装は次の責務を混ぜない。

| 論理状態 | 責務 |
| --- | --- |
| title state | 作品ごとのdesired version、current / previous artifact、未充足work projection |
| operation / job request / campaign | HTTP操作の監査、1作品または全作品の受理時点、作品別workとその充足状態 |
| job / attempt | 作品別target、lease、実行回数、safeな結果、出力checksum |
| execution slot | 全runtimeを横断する単一実行権、owner、期限、preempt intent、単調増加fence |
| outbox | version付きdeliveryの未配送・配送済み状態 |
| artifact / chunk | staging / published、version組、manifest、checksum、current / previous参照 |

全登録作品はtitle stateを1件持つ。確定試合が0件の作品でも、管理者の1作品・全作品runは空のoverall成果物へ
収束できる。登録作品が0件の全作品操作は受理しない。作品削除時は、未完了workを安全に閉じ、title stateと
artifactが既存master削除を永久にblockしないようにする。terminal jobの保持とUIの「直近3件」は別の契約であり、
terminal jobだけを終了後45日でcleanupできる。

### 2.3 request、campaign、coalescing

- queued中に新しいrevisionが来たら、同じjobを最新版へ集約する。running中に来たら、そのattemptを成功扱い
  せず、完了時にtargetを再確認して古いcandidateを捨て、jobをqueuedへ戻す。これはretryではない。
- 手動runは`forceRun`として永続化し、受理後に開始する実計算を少なくとも1回保証する。同一versionの既存
  artifactがあっても省略しない。
- 1作品操作はoperation requestと作品別job requestを同一transactionで作る。全作品操作はoperation request、
  campaign、受理時点のtarget snapshotを同一transactionで作り、作品別requestへ冪等に展開する。
- active attempt開始後に受けた手動requestを、そのattemptで充足したことにしない。未充足force runを
  title stateへ残し、active jobがterminalになったtransactionで次job / outboxを作る。複数requestは次runへ
  集約できるが、要求者・受理日時・operationの監査を失わない。
- 同じ`Idempotency-Key`の再送は同じoperationを返す。異なるkeyは別操作として保存し、後発操作の受理前に
  開始・完了したattemptで充足しない。
- campaign targetは展開前からwork intentである。展開途中のcrashや再実行でもtargetを欠落・重複させず、
  snapshot後に初めて確定試合を持った作品は通常の試合mutationで投入する。

同じversion組の手動runは、source input checksumとsemantic checksumを比較する。両方が一致する場合は
artifactを複製せず`reused`として成功させる。sourceが違えば`input_revision_violation`、意味payloadが違えば
`non_deterministic_output`として失敗させ、current artifactを維持する。

### 2.4 job状態とretry

| 現在 | event | 次 | retryへの計上 |
| --- | --- | --- | --- |
| `queued` | lease取得 | `running` | なし |
| `running` | version一致・検証成功 | `succeeded` | なし |
| `running` | 新revision / OCR preemption / graceful停止 | `queued` | なし |
| `running` | 一時的DB / queue障害 | `queued` または `failed` | 最大3回 |
| `running` | timeout | `timed_out` | なし |
| `running` | 決定論的計算・契約違反 | `failed` | なし |

lease回収は計算retryと分け、`leaseRecoveryCount`へ記録する。回収上限を超えたjobは
`lease_recovery_exhausted`で失敗させる。supersede、preemption、graceful停止はattempt outcomeとして記録するが、
retry回数へ含めない。queued jobの選択は決定的な順序で行い、戻ったjobを同priority列の後ろへ回して、頻繁に更新される
1作品による飢餓を防ぐ。

## 3. 配送、execution slot、fencing

### 3.1 queueとoutbox

分析queueの厳密なpayloadは `docs/schemas/series-analysis-queue-payload-v1.schema.json` を正とする。payloadは
`schemaVersion`とopaqueな`jobId`だけを運ぶ。作品、version、retry、権限、失敗状態をpayloadから信用せず、
workerはjob IDでDBを再読する。

1. APIまたはProcessing Workerのcontrol transactionがworkを作成・再武装するとき、outboxを同じDB transactionへ書く。
2. commit成功時だけ、outbox種別を持つtyped post-commit effectを返す。rollbackはeffectを返さない。
3. wakeは容量1のcoalescing hintであり、失われてもよい。outbox rowを正本とし、元deliveryのACK / leave-pending判断より前に
   effectをsinkへ渡す。
4. coordinatorはstartup drain、post-commit wake、最短retry / semantic deadline、設定されたcold recoveryで
   起動する。固定短周期poll、rowごとのtimer、無条件hot loopを作らない。
5. Redis appendとoutboxのdelivery確定の両方が成功して初めて配送完了とする。append成功後のDB更新失敗は
   同じjob IDの重複deliveryになり得るが、DB claimで安全に収束させる。
6. `queued`のままdeliveryを失ったjobは、DB stateからoutboxを再武装して回収する。再配送成功は計算retryとして
   数えず、利用可能なdeliveryが尽きた場合だけdependency failureとしてterminalへ収束させる。

APIとworkerのdispatcherはoutbox claimとfencingで競合を解消する。drain全体の依存障害は上限付きbackoffへ変換し、
追加wakeを失わず、正常drain後にresetする。unexpected coordinator exitはsupervisorがruntime failureとして扱う。
OCR roleが期限切れAnalysis holderを回収して分析outboxを作る場合もAnalysis wakeを返す。OCRの通常transient retryは
既存Redis PELを使い、Analysis outboxとして作り直さない。

### 3.2 deliveryとACK

- workerはDB leaseを取得できたdeliveryだけを実行する。terminal / running jobは状態に応じて安全にACKし、
  再計算しない。
- Analysis consumerの新規配送は`XREADGROUP ... > BLOCK`だけで待つ。`XADD`はこのserver-side blockを直ちに
  起床させるため、空queue時のblock値を伸ばしても通常の計算開始待ちにはしない。
- stale PELは起動時と低頻度cold intervalだけで、上限付きの`XAUTOCLAIM` pageとして回収する。pageを継続する前には
  必ず1回の新規配送readを挟み、空queueを短周期pollにしない。現workerがshared slotのbusyで残したentryだけは
  lease idle到達時に1件だけ再確認し、local予定を失ってもcold recoveryが回収する。
- jobの状態遷移と必要な次outboxをDBへ確定してから元deliveryをACKする。DB commitの成否が不明なら、
  job / attempt / artifactを再読してからACKまたはretryを決め、同じpublishを推測で再実行しない。
- Analysis Worker roleはsupportするalgorithm / artifact schema versionのexact setを宣言し、job claimも
  target versionがそのsetにあることを条件にする。非対応workerは未知versionを計算・terminal化せず、
  durableな再配送を残してcompatible workerへ渡す。
- どのoutbox driverも、campaign展開、semantic reconcile、claim SQL、payload生成、Redis appendを
  それぞれの責務へ閉じる。supervisorはworker固有SQLやpayloadを知識として持たない。

### 3.3 slot、lease、preemption

analysis attemptの開始は同じDB transactionで次を満たす。

1. DB時刻で期限切れと判定できる固定execution slotをlockする。
2. 単調増加するfencing token、owner、job、attempt、期限を保存する。
3. jobがqueuedで、作品別active制約とversion capabilityを満たすことを確認する。
4. job leaseへ同じownerとfenceを保存し、jobをrunning、attemptを開始済みにする。

- lock順は `execution slot -> title state -> job -> request / artifact` に統一する。試合mutationとcampaign展開は
  execution slotを取得せず、複数title stateはgame title IDの決定順でlockする。
- lease判定とheartbeatはDB clock、timeoutは親processのmonotonic clockを使う。業務日時もDB clockで記録する。
- heartbeatはslotとjob leaseを同一transactionで延長する。更新0件、fence不一致、または安全余裕を超える接続障害を
  検知した親は子を停止し、publicationを試みない。
- publish、terminal遷移、slot解放はowner、job、attempt、fence、lease、target / desired versionの一致を
  必須にする。leaseを失った古いchildは、正しいcandidateを持っていても公開できない。
- OCRのpreempt intentはDBに残す。分析親がheartbeatで検知してchildを止め、jobをqueuedへ戻しslotを解放してから
  OCRが取得する。未充足intentがある間、新しい分析attemptはslotを取得しない。OCR holderはnon-preemptibleである。

## 4. Worker、artifact、原子的公開

### 4.1 parent / child境界

`momo-analysis-core`はPostgreSQL、Redis、async runtime、process、filesystem、clock、環境変数に依存しない
決定論的coreとする。Processing Worker runtimeだけが外部値をfallibleにdecodeし、coreへversion付き論理型を渡す。
productionのprocess isolationはLinuxでfail closedにし、OS非依存のpure core testとruntime testを混同しない。

| 関心事 | parent | attempt child |
| --- | --- | --- |
| 実行単位 | deliveryをlease / fence付きattemptへ変換し終了まで監督する | 1 attemptだけ実行して終了する |
| 外部副作用 | DB、Redis、object storage、ACK、outbox、current pointer | durable DB write、Redis、object storage、ACK、outboxを行わない |
| process安全性 | spawn、cgroup attach、heartbeat、timeout、preemption、termination、reap | parent livenessを失えば終了し、grandchildを残さない |
| 結果 | bounded candidateを検証してfenced transactionで反映する | non-authoritativeなbounded candidateだけを返す |

childはread-only repeatable-read snapshotでtarget revisionを確認し、入力を決定順で読み、実在する`overall`、season、map、
season×mapだけを生成する。seasonとmapの直積から空scopeを作らない。1試合のmatch contextは最大4 scopeに限定する。
childとparentは入力・chunkを作品全体ぶん複製せず、streamingと上限付きdirectoryを使う。timeout、shutdown、preemption、
owner喪失ではprocess group全体をreapし、fenceだけをCPU / memory排他の代用にしない。

### 4.2 artifact契約

- manifest、resource種別、scope、item key、byte数、件数、深さ、checksumの厳密なshapeはartifact JSON Schemaを正とする。
  schemaとnormal / invalid / canonicalization fixtureをRust encoder、parent validator、Scala readerのcontract testで共有する。
- `sourceInputChecksum`は表示専用metadataを除く確定入力とmatch revisionを決定順にhashする。root checksumは
  resource kind、scope、item key、canonical chunk、chunk checksumから決定順に作る。DB JSON表現、圧縮形式、
  file列挙順へ依存しない。
- chunkはUTF-8・BOMなしのRFC 8785 JSON Canonicalization Scheme、source inputは型付きrecordと固定長の
  byte長prefix、rootはmanifest entryの決定順でhashする。canonicalization規則を変える場合はartifact schema
  versionを更新し、共有fixtureを同じ変更で更新する。
- checksumは`sha256:` prefix付きlowercase hexに統一する。artifact / job / attempt ID、日時、表示名、処理時間は
  semantic checksumへ含めない。payload内IDと配列順は意味契約の一部とし、runごとのUUIDや可変表示名を混ぜない。
- 件数、順位、試合番号、金額は整数として扱い、加算・積算はoverflowをwrap / saturateしない。有限値以外、負の0、
  欠損cell、重複ID、未決定順はvalidatorが拒否する。対象なし・分母0・sample不足は数値を捏造せずtyped qualityで表す。
- payloadにはstable IDと意味codeを保存し、可変表示名はAPIでhydrateする。APIやWebは意味順を再sortせず、
  artifactにない計算値を再構成しない。
- aggregate、review、drilldown、match contextは各chunkのencoded / decoded byte数、件数、深さに上限を持つ。
  上限超過artifactは公開せず、APIが作品全体をdecodeしてから判定しない。
- manifestはchunkのallowlistである。attempt directory外へのpath、symlink、未宣言・欠損file、checksum不一致を
  validatorが拒否し、正常・失敗・timeout・起動回収のすべてでattempt directoryをcleanupする。

### 4.3 publication

publicationは長いstagingと短いfenced publishを分ける。

1. **staging:** parentはattempt directoryのchunk / manifestをstreamingで検証し、未公開artifactとchunkを
   DBへ投入する。この段階ではexecution slot、title state、jobをlockしない。失敗・commit応答不明はfresh接続で
   stagingを再構築または完全照合し、成功を推測しない。
2. **publish:** fresh接続の短いtransactionでslot、title state、jobを一定順にlockし、owner / attempt / fence /
   lease / target / desired version、manifestの完全性、chunk上限とchecksum、match contextのrevisionと参照整合性を
   再検証する。成功時だけartifactをpublishedにし、旧currentをprevious、新artifactをcurrentへ切り替え、
   job・request・次のforce run・slotを同時に更新する。

どちらのphaseでもpayload全体をmemoryへ載せない。Phase Bの失敗はtransaction全体をrollbackし、stagingはcurrentから
不可視にする。Phase Bの短いcritical sectionだけはpreempt不可であり、OCRはその完了を待つ。

### 4.4 観測と公開境界

業務状態はDBから読み、logやmetricから逆算しない。slot holder、queued / stale work、campaign target、attempt outcome、
safe failure code、delivery / recovery、artifact reuse、bounded read拒否、queue待機、各phase時間、child / worker memory、
chunk / temporary byte数を、用途に応じて低cardinality metricまたは構造化logで観測する。個別IDはmetric labelへ入れず、
構造化logのopaque IDで相関する。secret、接続先、成果物本文、account情報、例外全文は出力しない。閾値、provider dashboard、
実測値はprivateのrelease evidenceを正とする。

## 5. 読み取りAPIとadmin API

### 5.1 共通原則

- v2のendpoint、query、response、error code、generated typeの現在形はTapir endpointと
  `apps/api/openapi.yaml` を正とする。旧pathの互換性を新decoderへ混ぜない。
- status APIとartifact APIを分ける。Webはstatusが返す`artifactId`をaggregate、review、drilldown、match contextの
  全requestへ渡し、1画面のresourceを同じartifact IDへpinする。
- artifact readは、そのartifactが対象作品のcurrent / previousとして読取可能であることの確認と、要求された
  1 chunkの取得を同じstatementまたはread transactionで行う。`validate -> delete -> read` raceを作らない。
- APIはendpoint、artifact ID、scope、member / metric / match IDに対応するbounded chunkだけを読み、作品manifest、
  他scope、全resourceを一括decodeしない。metadata hydrateはstable ID集合をboundedに集めたbatch queryへ閉じる。
- artifact schema versionとHTTP wire schema versionを分ける。workerが新artifactを公開する前にreader decoderの
  allowlistとcontract testを用意する。payload / decodeの上限と同時read数はresource gateの根拠でfail closedにする。
- status、options、admin、artifact responseは現在のmasterをhydrateするためprivate / no-storeとし、Webは
  artifact IDを含むquery keyで画面内cacheを所有する。

### 5.2 status、options、artifact resource

- optionsは全登録作品をmaster順で返す。season、map、season×mapは現在の確定試合に実在する値だけを返す。
  確定試合0件と登録作品0件を同じempty stateにしない。
- statusはdesired versionとcurrent artifactを比較してfreshnessを決める。Webはversion文字列を自前比較しない。
  calculation projectionはactive job、未展開campaign / 未充足request、最後のterminal runから作り、手動run失敗を
  current artifactの成功で隠さない。
- aggregate / reviewは、Webが意味を再計算しない完成粒度で、権威ある配列順、typed quality、reason、signal、
  relative intensity、candidate採否を返す。free stringやnullable collectionで意味を曖昧にしない。
- drilldownはdiscriminated payloadで返し、rowの業務順、増減方向、support、stability、method metadataを
  worker側で確定する。
- `match-context`は同一artifact内のaggregate itemを参照し、対象matchの現在の作品・scope・revisionを
  read transaction内で確認する。matchが変わった、scope外、artifact未収録なら、古いfeature、前後差、focusを返さない。
  別matchの変更だけでartifactがstaleな場合は、対象matchのrevisionが一致する限り文脈を表示できる。
- read可能でなくなったartifactは`ANALYSIS_ARTIFACT_EXPIRED`として扱い、Webはstatusを取り直して最新artifactで
  1回だけretryする。schema違反、未知decoder、scope不在、read busyは同期計算や別scopeへのfallbackで隠さない。

### 5.3 admin mutationと公開情報境界

- 1作品・全作品の再計算は管理者認証、CSRF、`Idempotency-Key`を要求し、operation requestを`202 Accepted`で返す。
  全作品操作は受理時点のtarget snapshotを作り、同期responseへ全作品のjob行を詰め込まない。
- admin overviewは選択作品のstatus、未充足手動run、全体slot / queue / campaign要約、直近3件を復元する。
  public statusにjob ID、account、attempt数、safe failure codeを出さない。
- safe failure code、要求者、retry / lease回収、version組は管理者の履歴に限定し、stack trace、接続先、成果物本文、
  internal exceptionをHTTP responseへ出さない。

## 6. Web表示、artifact切替、管理画面

### 6.1 Web計算境界

Webに残すのは、API enumからのlabel / semantic token / help textへの写像、locale表示、SVGの座標・軸・responsive layout、
URL・tab・scope・focus・drawer・ユーザー指定filterである。Webは次を行わない。

- median、rate、count、fold、signal、閾値、候補採否、意味を持つ色強度、順位・業務順の再計算
- raw match pointからのpanel、review、match featureの復元
- `sort`、`filter`、`slice`によるworker提供の候補採否・優先順の作り直し
- API値の欠損を0やfallback値へ静かに補完すること

`apps/web/scripts/check-architecture-imports.mjs` は、戦績比較のproduction sourceで統計関数や分析用の
`reduce` / `sort`を検出する。これは唯一の証拠ではないため、artifact fixtureを再計算せず表示するcomponent testも
維持する。成果物契約違反は当該resourceのread failureとして表示し、statusまたは再読込を案内する。

### 6.2 statusとartifact切替

| artifact | calculation projection | 表示 |
| --- | --- | --- |
| currentあり | `succeeded` またはなし | artifactと最終更新日時を表示 |
| staleあり | `queued` / `running` | 旧artifactを保ち「新しいデータを計算中」と表示 |
| currentあり | 手動 `queued` / `running` | 旧artifactを保ち「分析データを再計算中」と表示 |
| なし | `queued` / `running` | panelを出さない計算中empty state |
| なし | なし・確定試合0件 | 対戦データなしのempty state |
| あり / なし | `failed` / `timed_out` | 旧artifactは維持し、なければ分析値を出さない失敗empty state |
| あり / なし | status取得失敗 | 旧artifactを維持できるときだけ維持し、局所的な再読込を出す |

- controllerは`publishedArtifactId`と`displayArtifactId`を分ける。新artifactを取得する間は旧表示を保ち、
  latest-winsで古いrequestをabortする。
- mount、作品変更、明示的な「表示を再読み込み」、window focus、tab再表示、network reconnectでstatusを取得する。
  `queued` / `running`の間だけ5秒pollし、terminal・非表示tabでは停止する。表示の再読み込みはjobを作らない。
- 主表示resourceが切替必須であり、selected match contextは同じartifactでincludedなら主表示と一緒に切り替える。
  ancillary requestの失敗やdrilldownの失敗で主表示切替を無期限に待たない。artifact更新時は旧drilldownを閉じる。
- `410`はstatus再取得後に1回だけretryする。再度失敗したらloopせず、旧artifactがあれば維持して局所errorを出す。

### 6.3 試合詳細と管理画面

- 試合詳細は保存済みの一次データを直ちに表示し、分析欄だけを`match-context`へ委譲する。aggregate / reviewを
  試合詳細のために取得しない。対象matchのrevisionがartifactと違う場合、古い分析badgeや前後差は出さない。
- 比較画面のscope候補は現在optionsを正とする。現在有効だがartifactにまだないscopeは別scopeへfallbackせず、
  そのpanelだけ計算中または失敗として扱う。
- 管理画面は`/admin/analysis`に置き、通常利用者へ管理linkを表示しない。1作品run、全作品run、現在の判断に必要な
  status / queue行、直近3件を優先し、汎用dashboard風のKPI群を作らない。全作品runは確認dialogと同一idempotency keyの
  retryを持つ。登録作品0件ではUIとserverの両方が操作を拒否する。
- 状態noticeはartifact IDまたは状態が変わったときだけ`aria-live`で通知し、spinnerだけに依存しない。motion、
  touch target、色と文言の併用は `docs/ui-rule.md` を正とする。

## 7. 互換性、release、rollback

- DB migrationはadditiveに進め、reader-firstで新artifact schemaを読めるAPIを先に置く。readerと対応workerの
  capabilityを確認してからdesired version / campaignを作る。旧workerが非対応jobをclaim・失敗・配送消失させない。
- 新wire schemaはOpenAPIと生成Web型のcontract testを通す。旧browserは明示的なreload-required responseへ縮退し、
  tombstoneから分析engine、成果物本文、同期DB集計へ到達させない。
- artifact schemaからwire schemaへのprojectionは、rename、enum mapping、現在metadataのhydrateのような
  分析を伴わない変換に限る。旧artifactにない意味値をraw値から再計算しない。
- worker publicationを停止または前binaryへ戻してもcurrent artifactと未完了workを維持する。前binaryがdesired
  versionをsupportしなければjobをqueuedのままにし、旧algorithmへ黙って再計算しない。DBのdown migrationで
  revision / job / artifactを削除しない。
- release対象DBのmigration、reader / worker compatibility、immutable imageの来歴、physical memory hard limit、
  timeout、chunk / response / temporary storage上限を確認する。上限の具体値と実測はprivate evidenceを正とする。
- rollback後もScala同期分析やPython OCRを通常経路へ復活させない。current artifact、operation、campaign、request、
  jobをDBから引き継いで縮退・再開する。

## 8. 検証と受入条件

| 変更した契約 | 必要な証拠 |
| --- | --- |
| 数式、丸め、canonicalization、schema | schema / normal・invalid・canonical fixture、golden、高精度参照、property test。Scala値は差分検出に使えても唯一のoracleにしない。 |
| 試合mutation、revision、request、campaign | API / repository integrationで同一transaction、A→B移動、coalescing、idempotency、crash後reconcileを通す。 |
| queue、outbox、ACK、dispatcher | 制御可能clock、実Redis、post-commit wake、重複delivery、append後DB失敗、cold recovery、backoff、terminal write before ACKを通す。 |
| slot、lease、fence、preemption、child | 実PostgreSQLの複数接続と実processで、同時worker、失効fence、owner喪失、timeout、preemption、zombie防止、原子的公開を通す。 |
| artifact reader、match context、Web | schema validator、bounded query / decode、同一artifact pin、revision mismatch拒否、Web static checker、fixture component test、PC / mobile Playwrightを通す。 |
| version / release / rollback | reader-first、version capability、旧clientのreload導線、旧engine不在、current artifact保持をcontrol-plane / release rehearsalで確認する。 |
| resource上限 | 上限側fixture、本番同等runtime、child / worker / API / browserを別々に測る。未取得の外部peakやprivate evidenceを通常CI成功で代用しない。 |

具体的なコマンドと変更gateは `docs/dev-rule.md` を正とする。DB・Redis・Linux process・browser・resourceの外部境界を
skipした場合、その境界は未検証として報告する。完了前に `docs/post-mortem/lessons.md` の該当カードを確認し、
発見した恒久ルールはこの文書ではなくowner文書へ置く。
