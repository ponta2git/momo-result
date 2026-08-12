# 戦績分析バッチ 要求仕様

本書は、戦績比較ページと振り返り表示に必要な計算をHTTPリクエスト経路から分離し、
作品単位の非同期バッチで事前計算するための要求仕様である。指標と表示内容は
`docs/requirements/series-comparison.md`、行動プレイブックは
`docs/requirements/series-review-playbook.md` を正本とする。

provider固有の構成値、実測値、費用、リリース判定記録はpublic文書へ置かず、privateの
運用要件で管理する。

job、artifact、API schema、Web計算境界、IA / UX / UIの具体的な実現契約は
`docs/series-analysis-realization.md` を正本とする。

---

## 0. 最終判断

- 戦績比較に必要な通常集計、振り返り、高度な順位分析、ドリルダウン用データは、作品単位で
  非同期に事前計算する。
- APIは保存済み成果物と計算状態を読み取るだけとし、HTTPリクエスト中に戦績分析を実行する
  fallbackを持たない。
- 初回リリースから計算処理とworker制御をRustで実装する。Scala版との結果互換は希望要件とし、
  文書化された数式と統計的な正確性を優先する。
- workerはAPI/OCRの実行資源から分離し、利用者向けHTTP APIを持たない単一実行枠のruntimeとする。
  provider固有の配置、台数、資源値はprivate運用要件を正本とする。
- 1ジョブは1作品の全スコープを計算し、成功成果物は作品単位で原子的に公開する。
- DBをジョブ、再計算intent、成果物、状態の正本とし、Redis Streamsは配送路としてのみ使う。
- OCRを同じworkerへ移す場合も同時実行枠は1とし、OCRだけが実行中の分析を中断できる。
  分析はOCRを中断できない。

---

## 1. 目的と成功条件

### 1.1 目的

- 高負荷な分析がAPI、画面表示、試合記録、OCRの応答性や可用性を巻き込まないようにする。
- 同じ入力に対する重複計算をなくし、集計、振り返り、ドリルダウンで同じ計算結果を再利用する。
- 計算の待機、実行、成功、失敗、タイムアウトを利用者と管理者が判断できるようにする。
- 将来の計算式変更やworker実装変更でも、入力versionと計算versionを追跡できるようにする。

### 1.2 成功条件

- 戦績比較関連のHTTP endpointを呼んでも、分析engineがAPIプロセス内で実行されない。
- 試合結果の変更後、対象作品の再計算intentが同じ業務transactionから失われずに作成される。
- 同じ作品へ変更が連続しても、不要な中間versionを全件計算せず、最終的に最新版の成果物へ収束する。
- 計算中または失敗時も、過去の成功成果物があれば閲覧を継続できる。
- workerの停止、子プロセス異常終了、配送失敗、再配送があっても、部分成果物や二重公開を生じない。
- 初回リリースのresource/performance gateを、本番同等runtimeで通過してから公開する。

---

## 2. 用語とversion

| 用語 | 意味 |
|---|---|
| 分析ジョブ | 1作品について、全スコープと全表示用途の成果物を再計算する単位。 |
| 入力version | 成果物の入力になった確定済み試合データのversion。作品単位で比較可能にする。 |
| algorithm version | 数式、特徴量、fold、seed、閾値、候補選択など、計算結果の意味を識別するversion。 |
| artifact schema version | 保存成果物の構造と読み取り互換性を識別するversion。algorithm versionとは分離する。 |
| 成果物 | 戦績比較、振り返り、ドリルダウン表示に必要な事前計算済みデータ一式。 |
| 再計算intent | DBに保存された、対象作品を少なくとも指定versionまで再計算する要求。 |
| 有効スコープ | 総合と、確定済み試合が実在するseason、map、season×map。seasonとmapの空の直積は含めない。 |
| preemption | OCR同居時、OCR優先のため実行中の分析を中断して待機状態へ戻すこと。 |

version比較は文字列の偶然の大小へ依存させない。どの入力versionとalgorithm versionから生成した
成果物かを明示的に保存し、APIはartifact schema versionを検証してから返す。

入力versionは作品ごとの単調増加revisionとしてDBで採番し、対象となる試合mutationと同じtransactionで
進める。timestampの解像度やworkerが取得した最大更新日時をversionの代用にしない。

---

## 3. 再計算トリガー

### 3.1 自動トリガー

次の場合、対象作品の再計算intentを自動作成する。

- 試合結果を確定したとき。
- 確定済み試合を更新したとき。
- 確定済み試合を削除したとき。
- algorithm versionを更新したとき。全作品を対象とする。
- artifact schema versionを更新したとき。全作品を対象とする。
- 初回リリース時。確定済み試合を持つ全作品を対象とする。

試合mutationと再計算intentは同じDB transactionで確定する。Redisへの直接publish成功を
mutation成功条件にせず、outbox dispatcherが未配送intentを回収できるようにする。

確定済み試合の更新で作品がAからBへ変わる場合は、変更前後の確定済みデータ集合に含まれる作品の
和集合を影響対象とし、AとBの両方の入力versionと再計算intentを同じtransactionで進める。

algorithm / artifact schema更新と管理者の全作品triggerは受理時点の全登録作品、初回backfillは
確定試合を持つ作品集合を
永続的にsnapshotし、作品別intentへ冪等に展開する。
展開途中の停止で一部作品を失わず、snapshot後に新たに対象となった作品は通常の試合mutation triggerで扱う。

### 3.2 手動トリガー

- 管理者専用メニューから再計算を要求できる。
- 手動再計算は既存のadmin mutationと同じ認証、CSRF、`Idempotency-Key` 契約に従い、要求した
  accountを監査情報として保存する。
- 手動HTTP操作の監査・冪等単位と、作品別に集約できる再計算intentを分離する。同じ
  `Idempotency-Key` の再送は同じ操作を返し、異なるkeyは別操作として受理する。
- 既定操作は、現在選択している1作品の再計算とする。
- 全作品再計算は、1作品再計算と区別した明示操作にする。
- 全作品操作は作品ごとのジョブへ展開し、1つの巨大な全作品ジョブを作らない。
- 実行中または待機中の作品へ再度要求した場合も、作品単位で最新版へ集約し、同一入力を並列計算しない。
- 手動再計算は現行成果物が最新でも実計算する。active job中の複数手動要求は、監査記録を残したうえで
  未充足の強制run 1回へ集約してよい。
- active attempt開始後に受理した手動要求は、そのattemptで充足したことにしない。次に開始する実計算を
  永続的に予約し、画面再読込後も未充足予約を確認できるようにする。
- 異なる全作品操作はそれぞれの受理時点と対象snapshotを保持する。作品別計算を集約する場合も、各操作の
  受理時刻より前に開始・完了したattemptで後発操作を充足したことにしない。
- 同じ入力version、algorithm version、artifact schema versionの現行成果物がある手動runは、出力の
  canonical checksumが一致すれば既存成果物を再利用して成功とする。一致しなければ決定論違反として
  失敗させ、現行成果物を維持する。
- 同じ入力versionで確定入力自体のcanonical checksumが変わっていた場合は、出力決定論違反ではなく
  入力version更新漏れとして区別し、現行成果物を維持する。

---

## 4. ジョブ状態と配送

### 4.1 状態

分析ジョブは少なくとも次の状態を持つ。

- `queued`: 実行待ち、またはpreemption後の再実行待ち。
- `running`: workerがleaseを取得し、子プロセスを実行中。
- `succeeded`: 対象入力versionの成果物を原子的に公開済み。
- `failed`: 自動再試行しない計算失敗、または再試行上限へ到達した失敗。
- `timed_out`: 設定済みハードタイムアウトにより子プロセスを終了した失敗。

preemptionはterminal状態ではない。`running` から `queued` へ戻し、失敗回数や自動再試行回数へ
加算しない。管理用にpreemption回数と最終preemption日時は記録してよい。

### 4.2 正本と冪等性

- ジョブ状態と再計算intentの正本はDBとする。
- Redis deliveryにはジョブを一意に識別する値だけを持たせ、完全な業務状態を正本化しない。
- 分析deliveryはOCRとは別のversion付きstream / consumer group契約を持ち、payload schemaを混在させない。
- workerはDB上で実行権を取得できたdeliveryだけを処理する。
- workerは自身がsupportするalgorithm / artifact schema versionのjobだけをclaimする。非対応versionを
  計算失敗へせずqueuedのままdurableに再配送し、対応workerへ到達させる。
- 実行権は全worker processとdeploy世代を横断するDB上の単一slotと単調増加fencing tokenで管理する。
  lease失効後の旧workerはheartbeat、terminal遷移、成果物公開、slot解放を行えないようにする。
- terminal DB writeが成功してからdeliveryをackする。
- worker停止後に残ったleaseやpending deliveryを回収し、同じジョブを安全に再実行できるようにする。
- 同一入力version、algorithm version、artifact schema versionの成果物公開は冪等にする。

### 4.3 同時実行と再試行

- 分析workerの同時実行数は、runtime台数やconsumer設定によらず全作品合計で1とする。
- 一時的なDBまたはqueue障害だけを、初回実行とは別に最大3回自動再試行する。
- タイムアウト、入力契約違反、決定論的な計算失敗は自動再試行しない。
- owner消失によるlease回収は一時障害retryと別に有界化し、無限回収loopを許さない。graceful停止と
  将来のpreemptionは回収回数へ含めない。
- 新しい入力versionが到着した場合、古い未実行intentは最新版へ集約する。
- 実行中に新しい入力versionが到着した場合、古い成果物を公開せず、完了後または中断後に最新版を再計算する。

---

## 5. 計算と成果物

### 5.1 計算範囲

1作品ジョブは、次を一度の入力snapshotから計算する。

- 総合と、確定試合が実在するシーズン別、マップ別、シーズン×マップ別スコープ。seasonとmapの
  直積から対象0件のscopeを生成しない。
- 戦績比較の通常集計、グラフ、ヒストグラム、品質状態、ハイライト。
- 振り返りと行動プレイブック。
- 高度な順位分析。
- 汎用ドリルダウンで必要になる履歴、fold情報、根拠試合情報。
- 選択試合の前後差分、panel上の対応、試合詳細で表示する派生注目点など、試合単位の分析文脈。

試合単位の分析文脈には、分析入力へ影響する更新ごとに進む試合revisionを保存する。読み取り時の
現在revisionまたは作品所属と一致しない文脈は返さず、新しい一次データへ古い派生分析を併記しない。

同一スコープの高負荷計算は1回だけ行い、通常集計、振り返り、ドリルダウンへ再利用する。
フロントエンドまたはAPIで許容する加工は、表示ラベル、locale、装飾、単純なViewModel変換に限る。
採用判定、閾値判定、スコアリング、並び順、統計値を再計算しない。
chartの座標、軸、tick、responsive layoutはフロントエンドで計算してよいが、中央値、相対強度、
意味を持つ強調、候補share、表示対象window、欠損cell補完を再計算しない。

### 5.2 原子的公開

- 成果物は1作品、1入力version、1algorithm version単位で一括公開する。
- 途中のスコープやパネルだけを現行成果物へ混ぜない。
- chunkはAPIから読めないstagingへboundedに投入してよい。全chunk検証後の短いfenced transactionだけで
  published化とcurrent / previous pointerを切り替え、未完stagingは表示へ露出させない。
- 予期しないエラーが1スコープでも発生した場合は作品ジョブ全体を失敗させ、直前成功成果物を維持する。
- 対象データなし、分母0、サンプル不足、定義済みのモデル非採用・非収束は、仕様化された品質状態を含む正常成功として扱う。
- 子プロセスの異常終了、タイムアウト、preemptionで部分成果物を公開しない。
- 公開transactionは全体実行slot、job lease、attempt、fencing token、target versionを再検証し、lease失効後に
  完了した旧processからの公開を拒否する。

### 5.3 保持

- 各作品について、現行成功成果物と直前成功成果物を保持する。
- terminal jobの履歴は終了日時から45日間保持する。`queued` / `running` は保持期限による削除対象にしない。
- 管理画面に表示するジョブ履歴は直近3件とする。
- 保持期限を過ぎたjob、試行、診断情報は削除対象とし、成果物の参照整合性を壊さない。
- artifact schemaを更新するdeployでは、現行成功成果物を読めるAPI互換性を新成果物の公開まで維持する。
  schema更新だけを理由に、直前成功成果物を先に削除または閲覧不能にしない。

---

## 6. 数値正確性とRust移行

### 6.1 優先順位

- 文書化された数式、分母、同値処理、seed、境界条件を正本とし、数値の正確性を必須とする。
- 現行Scala版との互換は希望要件とする。Scala版より正確であることを決定論的に説明できる差異は許容する。
- 意図しない移植差異、入力順による揺れ、未説明の丸め差は不具合として扱う。
- 正確性のため計算意味を変えた場合はalgorithm versionを更新する。

### 6.2 差異の証明

Scala版と異なる値を採用する場合、少なくとも次のいずれかで改善を証明する。

- 高精度な参照計算との比較。
- 要求仕様の数式から手計算可能なgolden fixture。
- 境界値と性質を固定した決定論的テスト。

整数、ID、enum、品質状態、候補採否、表示順は、仕様変更がない限り完全一致させる。浮動小数点は
保存時の正規化・丸め規則を仕様化し、その前後の比較方法をテストで固定する。

### 6.3 実装制約

- 初回リリースの本番計算経路にJVMまたはScala分析engineを残さない。
- Scala版は移行中の比較oracleとして利用してよいが、本番HTTPまたはworkerのfallbackにしない。
- 初回リリース完了時はScala oracleをtestまたはmigration toolへ隔離し、APIのproduction source / runtime
  artifactへ分析engineを含めない。
- 二次的な組み合わせ全件を中間collectionへ展開するなど、入力増加に対して不要な割り当てを行わない。
- bootstrap反復やscope反復で再利用できる入力、buffer、計算結果を再利用し、反復数に比例して
  生存memoryが増えないようにする。
- 同じ入力とalgorithm versionから同じ結果を生成する。

---

## 7. 読み取りAPIと画面状態

### 7.1 API

- 選択肢、集計、振り返り、ドリルダウン、選択試合文脈APIは保存済み成果物だけを読む。
- 新しい成果物契約はversion付きv2 APIとして提供し、既存同期APIへの必須query追加でflag dayを作らない。
- 成果物がない、古い、計算中、失敗している場合も、APIプロセス内で同期計算しない。
- 軽量な状態APIと成果物APIを分ける。状態APIは表示可能なartifact ID、入力version、algorithm version、
  artifact schema version、成功日時、現在の再計算状態を返す。
- 集計、振り返り、ドリルダウン、選択試合文脈は状態APIで解決した同じartifact IDを必須入力とし、
  1画面内で成果物versionを混在させない。
- 各成果物endpointは要求された1 resource・1 scopeの上限付きchunkだけを読み、作品全体や他scopeを
  一括decodeしない。artifactの読取可否確認とchunk取得はcleanupと競合しない同一snapshotで行う。
- 一般利用者向け状態APIは計算中・成功・失敗・timeoutを返すが、job ID、account、attempt数、安全な
  診断codeを返さない。未充足の手動予約もjob作成前から `queued` として状態へ反映する。
- 内部例外、stack trace、provider情報、秘密情報をレスポンスへ含めない。

### 7.2 利用者向け表示

- `queued` または `running` で直前成功成果物がある場合、その成果物を表示したまま
  「新しいデータを計算中」と最終成功日時を表示する。
- 現行成果物が最新のまま手動強制runを行っている場合は、「新しいデータ」ではなく
  「分析データを再計算中」と表示する。
- 計算中は5秒間隔で軽量な状態確認を行い、成功時に成果物を自動更新する。terminal状態になったら
  pollingを止める。
- 初回計算中で成功成果物がない場合は、分析値を表示せず計算中の空状態を表示する。
- `failed` または `timed_out` で直前成功成果物がある場合、その成果物、失敗表示、最終成功日時を
  併記する。
- 成功成果物が一度もない状態で失敗した場合は、分析値を表示せず、汎用的な失敗表示を出す。
- preemptionは利用者向けの失敗として表示せず、`queued` と同じ計算中表示にする。
- 管理者に限り、計算中または失敗表示から分析管理画面へ移動できる。一般利用者へ管理操作を見せない。
- 対象試合自身のrevisionがartifactと一致しない場合は、一次データを表示したまま古い分析文脈だけを隠し、
  「この試合の分析を更新中」と表示する。

### 7.3 管理者向け表示

- 管理者専用メニューに独立した「分析管理」を置き、1作品再計算と全作品再計算を行えるようにする。
- 1作品再計算を既定の主操作とし、全作品再計算はsectionと確認dialogを分ける。
- 1作品再計算の候補は確定試合の有無を問わない全登録作品とする。既定は確定試合が最も新しい作品、
  それがなければmaster表示順の先頭とし、登録作品0件では操作できないempty stateを出す。
- 初期表示は全作品を横断して作成日時の新しい順に直近3件を表示する。作品別filterやpaginationは
  初回リリースに含めない。
- 直近3件について、対象作品、状態、要求元、作成・開始・終了日時、処理時間、入力version、
  algorithm version、試行回数、失敗コードを確認できる。
- 選択作品の未充足手動予約と、全体の実行中件数、待機作品数、最古の待機を再読込後も確認できる。
- 全作品要求のresponseは対象snapshotの件数とcampaign IDを返し、作品別job全件を巨大なresponseとして
  返さない。展開状況は管理overviewから再読込できるようにする。
- preemptionを導入した後は、preemption回数と待機時間を確認できる。
- 失敗詳細は安全な分類済みcodeと運用可能な要約に限定し、内部例外messageやstack traceを表示しない。

---

## 8. resource・性能・タイムアウト

- workerはAPIおよびOCRとresourceを共有しない独立runtimeに置く。
- provider固有のresource上限はprivate運用要件で固定し、その上限を満たすことを初回リリース条件とする。
- 性能fixtureは固定4名、全有効スコープ、現在データ量の2倍かつ最低500試合/作品を満たす。
- 上限fixtureを連続100回処理しても、OOM、runtime再起動、未解放memoryの増加傾向を起こさない。
- worker全体と子プロセスのpeak memory、処理時間、成功率を計測する。
- runtime上限とは別に親processの生存余白を確保した子process memory上限を設け、子の上限超過でも親が
  terminal失敗を保存できるようにする。
- 採用runtimeで子process単位のhard limitが実際に機能し、超過時も親processが生存することを事前に
  実証する。利用できない場合は親子process構成だけでmemory要件を満たしたと扱わない。
- 同じ上限fixtureについて、Scala APIのDB取得量、decoded payload、response size、peak memory、latencyと、
  対象browserのparse・render・heap・操作応答も計測する。workerだけを測ってrelease可としない。
- artifactはaggregate、review、drilldown、match contextごとに件数・decoded byte・ネスト上限を持ち、
  超過時は公開しない。一時成果物にもfile、総byte、空き容量の上限と全終了経路のcleanupを設ける。
- ハードタイムアウト機構と設定項目は初回リリースから必須とする。
- タイムアウト値は、本番と同じresource classのruntime上で候補版を実測した後に決定する。
- 実測では少なくとも通常データ、上限fixture、cold start、連続実行のp50、p95、p99、最大時間、
  peak memoryを記録する。
- 本番用タイムアウト値が未設定のまま公開しない。
- 機能テスト、runtime起動、health成功だけをresource/performance gateの代用にしない。
- DBを管理状態の正本としたうえで、実行中0/1、待機作品数と最古待機、結果別job / attempt件数、timeout、
  lease回収、配送再作成、段階別処理時間、peak memory、chunk / 一時byte数を構造化観測する。
- chunk payload byte数とmanifestを含む一時総byte数を別項目で観測し、子診断reportと検証済みmanifestが
  矛盾する成果物は公開しない。worker peakは公開処理後のterminal永続化直前にも採取する。
- metrics labelへ作品・job・accountなどの高cardinality IDを入れず、個別追跡は秘密情報を含まないopaque IDの
  構造化logで行う。alert閾値、provider dashboard、実測値はprivateで管理する。

---

## 9. OCR統合制約

OCR同居runtimeの実装完了とproduction activationは分ける。activation gateを満たすまではAPI writerと旧consumerを
切り替えないが、分析とOCRの双方を停止可能な子プロセスとし、部分成果物を公開しない構造は共通で満たす。

同じworkerへOCRを移す場合:

- worker全体の実行スロットは1とし、分析とOCRを同時実行しない。
- OCR deliveryが到着したら、実行中の分析子プロセスを安全に終了してOCRを開始できる。
- 分析は待機中または実行中のOCRを中断できない。
- 中断した分析は失敗・タイムアウト・自動再試行回数に数えず、最新版へ集約して `queued` に戻す。
- OCRが連続する場合は分析が長時間待機し得る。管理画面で待機時間とpreemption回数を観測できるようにする。
- OCR開始前または成果物commit開始後など、中断不可能な短いcritical sectionを定義し、二重commitを防ぐ。
- 別runtimeからOCR画像を読むv2 queueは、認可された共有storage上の論理ID / opaque object keyを使う。
  runtime-local volumeの共有やAPIからの一時的なfile配信へ依存しない。
- Rust OCRのproduction activationは、version固定の回帰datasetでの項目別精度が非劣化または改善方向であること、
  FullHD peak memory、処理時間、cgroup隔離、object storage実疎通を満たして判断する。独立blind holdoutは
  release要件にせず、未知画像への一般化精度を保証したとは扱わない。新しい誤認識はRust側へ回帰fixtureを追加して
  前進修正する。費用削減だけを完了根拠にしない。

---

## 10. 受け入れテスト

最低限、次を直接検証する。

- 試合確定・更新・削除と再計算intentが同じtransactionで確定する。
- 確定済み試合が作品AからBへ移る更新で、AとBの両方が同じtransactionから再計算対象になる。
- 入力versionが作品単位で単調増加し、同時mutationでも欠落・逆行しない。
- 初回導入では確定試合を持つ全作品、algorithm / artifact schema version更新では全登録作品が投入される。
- 連続mutation、手動連打、worker再起動、Redis再配送でも作品単位で最新版へ収束する。
- deploy世代の異なるworkerを同時起動しても全体実行数が1を超えず、失効fencing tokenから公開できない。
- running開始後の手動要求が次attemptへ予約され、複数要求の集約、画面再読込、active job失敗後も
  未充足要求を失わない。
- 全作品target snapshotの展開途中停止と再実行で、作品の欠落・重複job・後発作品の誤追加がない。
- 確定試合0件の登録作品も管理者操作では空のoverall成果物へ収束し、登録作品0件では操作を受理しない。
- API endpointからRust/Scalaを問わず分析engineが呼ばれない。
- 通常集計、振り返り、ドリルダウンが同じ成果物versionを読む。
- 集計、振り返り、ドリルダウン、選択試合文脈が、状態APIで解決した同じartifact IDを読む。
- 各endpointが対象chunkだけを読み、作品成果物全体をdecodeしない。cleanupとのread raceでも整合して返す。
- 1スコープの予期しない失敗で部分成果物が公開されず、直前成功成果物が維持される。
- 対象なし、分母0、サンプル不足、定義済みモデル非採用が正常成功になる。
- 最後の確定試合を削除した作品は空の総合成果物を公開し、削除前の分析値を現行成果物に残さない。
- transient failureの最大3回再試行と、timeout・決定論的失敗の非再試行。
- queued / running / succeeded / failed / timed_out、初回成果物なし、stale成果物ありのUI decision table。
- 管理者だけがCSRF・冪等性契約を通して再計算を要求でき、既定操作が1作品、全作品操作が
  明示的に分かれている。
- 最新入力に対する手動runも実計算し、checksum一致時は成果物再利用、不一致時は現行成果物を維持して
  決定論違反として失敗する。
- 同じ入力versionでsource input checksumが変わるrevision更新漏れと、同じ入力から出力だけが変わる
  決定論違反を区別する。
- 管理画面が直近3件だけを表示し、45日経過jobが保持対象外になる。
- 45日を超えた `queued` / `running` jobを履歴cleanupが削除しない。
- artifact schema更新中も旧成功成果物を読み、新schema成果物の成功後に原子的に切り替える。
- Rust版の数値正確性、入力順独立性、seed再現性、algorithm version更新条件。
- Webが集計、閾値、意味順、候補選定、統計fallbackを持たず、保存済み意味判定を表示へ写像すること。
- 対象試合の更新・作品移動後は古いmatch contextを表示せず、別試合更新によるstale artifactは最終更新noticeと
  ともに表示できること。
- 連続artifact公開時にWebが最新だけへ切り替え、旧drilldownや異なるartifactのcontextを混在させないこと。
- provider固有の本番同等resource/performance gateと、設定済みタイムアウトによる子プロセス停止。
- OCR統合時は、OCRによる分析preemption、分析からOCRへの非preemption、再キュー、部分公開防止。
