# アーキテクチャ規約

目的: API / web / OCR worker / 戦績分析workerの構造、依存方向、実装境界を判断するための正本。

読む条件:

- 新しい module / package / feature を作る。
- API / web / OCR worker / 戦績分析workerの境界、依存方向、wire契約を変える。
- 認証、エラー、画像、server state、外部I/O、runtime構成を触る。

役割:

- この文書は「どう実装するか」を扱う。
- 業務意味論は `docs/domain-rule.md`、DB所有権は `docs/db-rule.md`、Redis/OCR queue は `docs/redis-streams-ocr-contract.md` を正とする。
- 戦績分析のjob、artifact、API pinning、Web計算境界、管理画面の具体契約は
  `docs/series-analysis-realization.md` を正とする。
- テスト選択は `docs/test-rule.md`、実行コマンドは `docs/dev-rule.md` を正とする。

## 1. System Map

| 領域 | 場所 | 主な技術 | 責務 |
|---|---|---|---|
| web | `apps/web` | React 19, React Router 7, TanStack Query 5, Zod, Tailwind CSS 4, Base UI | SPA、入力、確認、CSV/TSV取得 |
| api | `apps/api` | Scala 3, Tapir, http4s, Cats Effect, Doobie | HTTP API、認証、業務usecase、DB/Redis接続 |
| analysis / OCR worker | `apps/processing-worker` | Rust, Cargo, Tesseract | 作品単位の戦績分析、version付き成果物の原子的公開、OCR queue v2 consumer |
| DB | `../momo-db` | Neon PostgreSQL, drizzle | schema / migration / seed の正本 |
| Queue | Upstash Redis Streams | Redis Streams | OCR・戦績分析ジョブの配送。状態の正本にはしない |
| public HTTP runtime | `Dockerfile`, `deploy/`, `tools/cmd/momo-runtime-tool` | Debian slim, JVM, nginx, Go | web/APIの起動・監視・停止、静的配信、reverse proxy。PythonとOCRを含めない |
| analysis runtime定義 | `apps/processing-worker/Dockerfile`, `fly.analysis.toml` | Rust parent / child process | 公開HTTPを持たず、DB上の単一実行枠で分析 / OCR子processを管理 |

公開HTTP runtimeはwebとAPIだけを運用し、Go製runtime toolがJVMとnginxのlifecycleを管理する。戦績分析と
OCRはRust製の専用image・起動設定を共有し、公開HTTP runtimeへ同居させない。nginxはweb静的配信とAPI
reverse proxyを担い、worker runtimeは公開HTTPを持たない。
公開HTTP runtimeのJVMはheap、metaspace、compressed class space、code cache、thread stack、GC、認識CPU数、
JIT段階、OOM時の終了動作をimage内で明示する。HTTP request内で高負荷分析を実行しない前提で軽量JITを使い、
CPU集約処理を再導入する変更ではJIT設定を再評価する。nginx worker数も割当CPU数へ明示的に合わせ、build hostの
CPU数を自動継承しない。
分析publicationは上限値がすべて設定されるまでfail closedとし、本番同等環境での測定と切替は実装完了とは
別のrelease gateとして扱う。provider固有の配置、resource値、詳細手順、secret、攻撃対策の手順はpublic docsに置かない。

## 2. API

### 2.1 Wire Boundary

- API仕様の正本は Tapir endpoint 定義。`apps/api/openapi.yaml` は生成物だが、web 型生成入力なので差分確認対象にする。
- Auth のように Tapir 定義と手書き http4s route が分かれる場合も、path / query / header の wire契約は共有定数から参照する。OpenAPI と実routeの文字列を二重管理しない。
- HTTP endpoint、入力検証、認証/CSRF、usecase、repository を分離する。HTTP層へDB・Redis・業務分岐を直接詰め込まない。
- composition root は `momo.api.bootstrap`。HTTP module は endpoint / middleware / routing に閉じる。
- 外部システム境界は `momo.api.ports` と adapter で分離する。usecase は Redis、filesystem、worker wire payload を直接扱わず、application intent と domain value を port に渡す。
- 認証付き Tapir endpoint は `securityIn` / `serverSecurityLogic` で security input と通常 input を分ける。read / mutation / admin / master-management の共通形は API 基盤 object に集約し、HTTP module は raw account header / CSRF header tuple を直接扱わない。
- idempotency / rate limit / logging で使う HTTP operation label は `momo.api.http.HttpOperation` に集約する。label は replay scope として永続化されるため、route 変更時も互換性判断に含める。
- path / query / body / queue payload の raw value は境界で domain/application 型へ変換する。usecase に wire表現を渡さない。
- raw String ID は `BoundaryId` または各 ID の `fromString` で検証する。境界で `unsafeFromString` を使わない。
- 新規 boundary value は Iron refined type または既存 domain value object で表現する。raw `String` / `Int` は endpoint input、DB row、外部 payload の直後で検証し、usecase / engine へ未検証値を渡さない。
- API設定値は Ciris `ConfigValue` で読み込み、数値範囲や key 形式は Iron refined type で検証する。`sys.env` / `toIntOption` / `toLongOption` を loader ごとに直書きせず、共通 parser と architecture spec へ寄せる。
- optional field の有無で mode や副作用が変わる場合、その field は mode discriminator として扱う。意味論は生成 OpenAPI だけに置かず、要件・ドメイン・API規約に文章で残す。

API境界の一部は `ApiEndpointsArchitectureSpec` と `ApiRuntimeArchitectureSpec` で固定している。新しい境界規約を追加したら、文書だけでなく該当する architecture spec か lint へ寄せられないか確認する。

### 2.2 Usecase / Repository

- usecase は状態遷移、整合性、副作用を扱う。repository は SQL とDB入出力に閉じる。
- active limit、競合、attach不可など通常制御フローとして起こり得る repository 結果は ADT で返す。`RuntimeException` / `AppException` は予期しない不整合、DB制約違反、外部I/O失敗に限る。
- PostgreSQL repository は、SQL fragment 構築、DB row shape、domain/application 変換、公開 repository facade を分ける。Doobie query は named row case class へ decode し、`row._N` や巨大 tuple alias で domain を組み立てない。row から domain/application への変換は `fromRow` / `toItem` などの専用関数へ閉じる。
- 部分更新は入力差分だけで判定しない。既存値と入力値をマージした保存予定の実効状態で不変条件を検証する。
- 読み取りで検証した前提を後続更新で使う場合は、検証済みスナップショットを repository 契約に渡し、`UPDATE ... WHERE` で同時に照合する。
- usecase / HTTP test で使う in-memory adapter は、DB adapter の状態遷移 guard と同じ契約を表現する。DB側の guard が複数 table にまたがる場合は、対応する composite adapter 側で等価の判定を持つ。
- PostgreSQL repository / migration 前提に触れたら `docs/db-rule.md` と `docs/test-rule.md` の DB-backed API ルールに従う。
- 試合確定・確定済み試合更新・削除は、対象作品の戦績分析再計算intentを同じtransactionへ書く。
  Redis publishをtransaction成功条件にせず、DB outboxから配送する。
- 戦績比較の読み取りusecaseはversion付き成果物とjob状態を取得するだけにし、ScalaまたはRustの
  分析engineをHTTP request内で呼ばない。
- 状態取得と成果物取得を分離し、集計、振り返り、drilldown、選択試合文脈は、状態取得で解決した
  同じartifact IDへ固定する。APIごとにcurrent artifactを引き直してversionを混在させない。

### 2.3 Module Layout

- `momo.api.usecases` 直下は公開 usecase facade を置く。集計、採点、文言生成などの内部実装が大きくなる場合は `momo.api.usecases.<domain>` へ package-private object として分け、HTTP / repository から直接参照しない。
- Scala戦績比較engine / aggregationはproduction sourceから撤去し、旧endpointには固定reload-requiredを返す
  軽量tombstoneだけを置く。正確性oracleは共有canonical vector、合成境界fixture、手計算・高精度参照値、
  性質testとし、同期fallbackを戻さない。
- 戦績分析endpoint DTOは `momo.api.endpoints.SeriesAnalysisApiModels` のfaçadeに閉じ、
  保存成果物のdomain型、DB row、Tapir / Circe / Schemaを相互に漏らさない。
- repository / adapter / endpoint model は、複数 resource や複数 runtime 責務を 1 ファイルへ詰めない。1 ファイルが概ね300行を超えたら、公開型、contract、SQL alg、facade、test double、DTO family のどれが混在しているかを確認し、同一 package 内の top-level 定義分割を優先する。行数超過は API architecture spec で warning として報告し、単独では品質ゲートを失敗させない。
- composition root は `momo.api.bootstrap.ApiApp` に置くが、`ApiApp` は runtime 実装セットの選択に寄せる。Redis / rate limit / queue の infrastructure、maintenance、health details、usecase-to-HTTP wiring は bootstrap 配下の helper object へ分ける。
- 大きい純粋集計アルゴリズムを残す場合は、公開 facade から分離し、責務を名前で表す専用 package / file に置く。単に行数だけで細切れにせず、共通 mutable state や wire表現を漏らさない境界を優先する。

### 2.4 Error / Auth

- エラーは業務、認証、権限、入力、外部依存を区別し、UIが扱える Problem Details に正規化する。
- Discord OAuth session は HttpOnly Cookie と PostgreSQL `app_sessions` で管理する。
- OAuth provider 呼び出し、account lookup、session 作成、provider backoff は auth service に閉じる。HTTP module は state cookie 検証、redirect、cookie 発行、Problem Details 変換に寄せる。
- 認証主体は `momo_login_accounts`。試合参加者 `members` と混同しない。
- 状態変更 API は CSRF token を要求する。dev/test 認証はローカル・テスト専用で本番経路へ混ぜない。
- 409、413、429、503 はUIが意味を扱う可能性がある。汎用内部エラーへ潰さない。

## 3. Web

### 3.1 Layering

- `apps/web/src` は `app/`、`features/`、`shared/` の3層に分ける。
- 依存方向は `app -> features -> shared`。逆方向 import と feature 間の実装詳細 import を禁止する。
- `app` から feature への静的 import は `app/routeModules.ts` へ集約する。
- `features/matches/list`、`features/matches/workspace`、試合詳細の実装詳細を相互 import しない。
- 横断 API client、生成型、query key、共有UI、共通domain helperは `shared/` に置く。画面固有の状態・変換・UIは feature 配下に置く。
- `*Page.tsx` は composition とページ状態に寄せ、データ取得・mutation・複雑な状態機械は hook / controller / helper へ分ける。
- 大きい feature は `page/`、`model/`、`metrics/`、`charts/`、`drilldowns/`、`review/` のように責務名で物理分割する。1階層に page shell、可視部品、集計ロジック、drilldown、review 表示を混在させない。
- 本番 TS/TSX module は概ね300行以内に保つ。超過する場合は page shell、section、controller hook、view model、presentation helper、型、adapter facade の混在を疑い、責務名で分割する。module size checker は超過を warning として報告し、単独では lint を失敗させない。
- 本番コードから `@/test/*`、`shared/api/msw/*` を import しない。

web の import 境界は `apps/web/scripts/check-architecture-imports.mjs`、module size は `apps/web/scripts/check-module-size.mjs` で検査する。新しい層ルールを追加したら、可能な範囲で検査へ反映する。

### 3.2 UI

- Tailwind CSS を使う。
- Base UI は a11y primitive として `shared/ui` に閉じる。feature から Base UI を直接 import しない。
- 共有UIは `shared/ui/{actions,data,feedback,forms,layout,status}` に置く。
- 色、順位、状態、余白、階層、motion、開示、loading / empty / error、画面遷移の視覚・操作契約は `docs/ui-rule.md` を正本とする。
- semantic token と共有UIから外れる raw style や小さい操作領域は `apps/web/scripts/check-ui-consistency.mjs` で検査する。
- keyboard、label、focus、contrast は WCAG AA 相当を目標にする。
- 画像アップロードとCSV/TSV出力はPC主対象。通常操作はスマホでも破綻させない。

### 3.3 Server State

- API取得と server state は TanStack Query を使う。
- feature の Page/UI component から TanStack Query を直接 import せず、use* hook / controller に寄せる。横断 resource の query option factory は `shared/api/queryOptions.ts` に置き、feature は画面固有の選択・変換だけを足す。
- route 読み込みは `React.lazy` と route-specific Suspense skeleton を使える。mutation、フォーム保存、validation error、ユーザー操作中状態は明示的に扱う。
- React concurrent API は TanStack Query の cache lifecycle を置き換えない。`useTransition` / `useDeferredValue` は条件変更時の表示 settling、`useActionState` は form action 境界など、既存契約を保つ範囲に限定する。
- ページ失敗表示は `query.error` / `isError` だけで確定しない。認証、`enabled`、`isFetching` / `fetchStatus`、過去errorの再取得中状態を合わせる。
- `queryKey` は cache に保存する runtime data shape を表す。同じ backend resource でも raw response と ViewModel を同じ key に置かない。
- mutation 後に同画面で作成 resource を選択・表示する場合は、選択値だけでなく候補 list/select の cache も整合させる。
- 戦績分析状態は成果物queryと分離して管理する。`queued` / `running` の間だけ5秒間隔でpollingし、
  成功時に該当成果物queryを更新し、terminal状態でpollingを停止する。
- stale成果物を持つ計算中・失敗状態と、成果物が一度もない計算中・失敗状態を別のViewModelで扱う。
- 戦績比較の集計、意味を持つsort/filter、閾値判定、候補選定、統計fallbackはWebへ置かない。
  chart座標、locale表記、URL・選択状態だけをWebで組み立てる。試合詳細の派生分析も保存済み
  match-context成果物を読み、raw matchから再計算しない。

### 3.4 Form / React

- フォーム検証は Zod を基本にし、サーバー側でも同等の検証を行う。
- React event 由来の値は handler 内で同期的に退避する。state updater 内で event / DOM node を読まない。
- route param、prefill、hidden state 由来の workflow identifier を request transform で落とさない。
- `useActionState` / `useFormStatus` / `useOptimistic` / `<Activity>` は、既存経路より複雑さや不具合面を減らす場合だけ採用する。
- `use(promise)` で TanStack Query の cache / retry / auth error normalization を迂回しない。
- React Compiler は、既存 lint / format / CI と compiler diagnostic を安定統合できるまで採用しない。

### 3.5 API Client

- web 型は `openapi-typescript` 生成の `shared/api/generated.ts` を使う。
- API DTO 変更後は `apps/api/openapi.yaml` と `apps/web/src/shared/api/generated.ts` を更新する。
- HTTP呼び出しは `shared/api/client.ts` を通す。credential、CSRF、Problem Details 正規化を feature で再実装しない。
- 横断 resource API は `shared/api/<resource>.ts`。feature 専用変換は feature 側に置く。
- feature から `@/shared/api/generated` を直接参照しない。generated DTO は `shared/api/*` facade で受け、feature は用途別の型・変換を介して扱う。
- JSON mutation retry は、同じ操作・同じ payload に同じ `Idempotency-Key` を再利用する。payload が変われば新しい key を発行する。
- OCR intakeは画像uploadからjob作成まで同じ操作keyを再利用し、両方が成功してからkeyを完了する。upload側のfingerprintは画像内容のSHA-256、byte数、media type、file名を含め、同じkeyで別画像を受理しない。
- 公開HTTP DTOへ内部画像path、旧OCR field名、旧dev header名を戻さない。残存検出は `apps/web/scripts/check-api-contract.mjs` へ寄せる。

## 4. OCR Worker

- OCRの配送・制御・object取得は `apps/processing-worker/src/ocr`、OCR子のstdio adapterは
  `apps/processing-worker/src/child/ocr.rs`、native実装・親子protocol・typed domain contractは
  `apps/processing-worker/crates/ocr` に置く。queue / DB control、R2取得・整合性検証、停止可能な
  native OCR子processを分離し、OCR子は分析子と同じ固定cgroupを時分割で使う。
- OCR/画像解析に外部APIを使わない。
- OCR対象画面種別ごとに解析器を分け、共通前処理だけ共有する。
- 画面種別はrequestで明示し、`auto` modeを受理しない。
- 解析器は入力画像、画面種別判定、抽出結果、信頼度、警告、失敗理由を返せるようにする。
- queue v2は非公開R2 objectのopaque keyだけを配送し、取得後にbytes、SHA-256、media type、FullHD上限を
  workerでも再検証する。URL、bucket、credential、local pathをqueue payloadへ入れない。
- R2-backed image storeとobject reconcilerを同じruntime契約として運用し、reconcilerの設定または
  resource確保に失敗した状態でuploadを受け付けない。
- PostgreSQL runtimeはstorage modeにかかわらず `source_images` を画像lifecycleの正本とし、opaqueな
  relative object keyだけを保存・配送する。local modeもfilesystem object adapterを同じobject-backed
  storeへ接続し、DBを経由しないstandalone filesystem storeはin-memory runtimeと単体testだけに限定する。
- OCRジョブ状態の正本はDB。Redis Streams は配送路。
- queue 契約は `docs/redis-streams-ocr-contract.md`、payload schema は `docs/schemas/*.schema.json` を正本にする。
- native OCR、Redis、PostgreSQL、R2、tessdataを要する検証は通常のCargo testと分離する。unit testでは
  parser、payload validation、状態遷移、failure mappingを優先し、外部wireは専用smokeで検証する。
- `momo-ocr` は Tesseract を含むOCR capability crateであり、親processのspawn、cgroup、timeout、kill、
  reap、queue ack、retry、DB状態遷移を所有しない。protocol codecとTesseract backendは同crate内に置き、
  将来のnative crate / binary差し替えはこの境界の内側で行う。

## 5. Processing Worker

- workerはRust + Cargo workspaceとして `apps/processing-worker` に置く。`crates/analysis-core` の
  `momo-analysis-core` は決定論的な
  計算kernelとversion付き成果物契約、`momo-processing-worker` は起動・設定・logging、job lease / queue、入力snapshot、
  成果物staging、DB / Redis / process adapterを所有する。依存方向はruntimeからcoreへの一方向だけとする。
- coreはDB row、Redis client、HTTP DTO、filesystem、clock、environment、async runtimeへ依存しない。
  queue / artifactのwire型はversion付き契約としてcoreに置けるが、transport処理はruntimeに残す。
- runtimeでは `series_analysis` と `ocr` を能力別consumer、`supervisor` を両consumerの
  shutdown / failure境界、`control` をDB状態遷移、
  `artifact` をbounded成果物境界、`database` を入力adapter、`process` をOS隔離境界、`child/analysis` と
  `child/ocr` を子process entry adapterとする。計算結果から制御動作への変換は副作用のないdecision tableへ寄せる。
- 親processはdelivery受信、DB上の全体実行slotとfencing token、job lease、timeout、signal、子process回収を
  担当する。1作品の計算は停止可能な子processで実行し、子processから現行成果物を直接更新しない。
- 親子契約は、能力crateが論理request/result/failureとversion付きcodecを所有し、rootがtransportとprocess
  lifecycleを所有する一方向関係に固定する。OCRのnative domain failureと、親が観測するOOM/crash/timeoutは
  別の型として扱い、現行の外部failure code写像は互換性のため維持する。
- release imageは固定root bootstrapだけでchild cgroupを準備し、`cgroup.procs`以外のcontroller操作をworkerへ
  委譲しない。bootstrapは全UID/GIDと補助groupを固定service identityへ恒久的に落としてからworkerをexecする。
  高負荷childはattach/readback完了後にだけ開始し、物理memory hard limitはcgroupを正本とする。
  `RLIMIT_AS`の回帰probeをproduction hard limitの証拠として扱わない。
- 同時実行数1はprocess内semaphoreやruntime台数で保証せず、deploy世代を横断するDB execution slotで
  保証する。lease失効後の旧fencing tokenではheartbeat、terminal化、公開、slot解放を拒否する。
- job、再計算intent、成果物、状態はDBを正本とし、Redis Streamsは配送路に限定する。
- 全作品操作とalgorithm / schema昇格は、受理transactionで要求version付きcampaign targetだけをsnapshotする。
  HTTPやrelease CLIで作品別jobを同期作成せず、API dispatcherが1 targetずつ短いtransactionで展開する。
  campaign受理後に開始済みのattemptだけを共有でき、受理前からrunningのattemptには次runを予約する。
- terminal DB writeに成功してからdeliveryをackする。lease切れ、pending delivery、重複deliveryを
  冪等に回収し、同じversionの二重公開を防ぐ。
- 入力snapshotは作品単位で一貫させ、確定試合が実在するスコープを計算してから1transactionで成果物を公開する。
  timeout、異常終了、予期しない計算失敗、preemptionでは部分成果物を公開しない。
- 子processはattempt専用directoryへ上限付きchunkだけを書き、親processがpath、件数、size、schema、checksumを
  streaming検証する。APIも要求されたresource・scope chunkだけを読み、作品成果物全体をdecodeしない。
- 入力version、algorithm version、artifact schema versionを別の型として扱う。文字列比較や時刻の
  偶然の大小で鮮度を決めない。
- 対象なし、件数不足、定義済みのモデル非採用はtypedな品質状態として返す。予期しない例外を
  正常な `no_target` に変換しない。
- 計算は同じ入力とalgorithm versionで決定論的にする。seed、入力順、浮動小数点の正規化・丸め、
  同値処理を明示する。
- 4人・signal・係数行列など仕様上固定長の値はenum、array、const genericsで表し、要素数不整合をruntimeの
  `Vec` / index検査へ持ち込まない。scopeや試合のような動的集合は決定順を持つcollectionと借用keyを優先する。
- OS FFIとproductionの `unsafe` は `process` moduleへ隔離し、lifetime、所有権、RAIIで解放を保証するsafe APIを
  workerへ公開する。productionの子process隔離契約はLinuxでのみ有効とし、他OSではjob claim前にfail closedにする。
  DB rowはadapter境界でfallibleにdecodeし、schema driftをpanicへ変えない。
- 純粋計算はpipeline、resource走査、集約、指標、trend、品質判定、rank、playbookへ、control planeは
  vocabulary、capability、claim、lifecycle、completion、publication、recovery、transactionへ分割する。
  入力は一度だけ正規化したimmutable型をchecksumと計算の双方へ渡し、失敗状態と制御動作はenumで全分岐を表す。
- Rust moduleはtestを含め900行上限とし、coreのruntime依存禁止、productionのlint抑制禁止、`process` 外の
  `unsafe` 禁止、fallible DB row decodeをarchitecture testで固定する。行数は設計の代用ではなく、責務混在を
  reviewするための上限として扱う。
- 初回からハードタイムアウトを設定可能にする。設定値がない本番起動またはjob受付はfail closedにし、
  値自体は本番同等runtimeでの実測後に確定する。
- `worker` supervisorは分析loopと明示有効化されたOCR v2 loopを同じshutdown / failure境界で動かす。
  OCR v2の有効化は分析publicationと完全なbounded設定を前提とし、暗黙には有効化しない。
- 同居時も実行枠は1とする。OCRだけが分析子processをpreemptでき、分析はOCRをpreemptできない。
  preemptされた分析は子process groupを回収し、失敗回数へ加算せず最新版へ集約して再度 `queued` にする。
- OCR配送は認可された共有storageの論理ID / opaque object keyを使う。local絶対pathをworker間契約へ
  持ち込まない。
- 要求、状態、保持、再試行、正確性、性能の正本は
  `docs/requirements/series-analysis-batch.md` とする。
- job、queue、chunk成果物、原子的公開、artifact-pinned API、Web状態機械の実現契約は
  `docs/series-analysis-realization.md` とする。

## 6. Runtime / Security / Ops

- Secrets、session ID、OAuth token、CSRF token、Redis URL、DB URL、画像内容、OCR raw text全文、
  戦績分析成果物本文をログに出さない。
- 例外ログは throwable の message / stack trace を直接出さず、例外クラス列などの安全な情報に絞る。
- 本番 `REDIS_URL` は原則 `rediss://` を必須にする。provider が TLS 非対応の内部接続として案内している場合だけ、明示設定付きで `redis://` を許可する。
- 本番PostgreSQL接続はCAとhostnameを検証し、接続文字列が要求するTLS channel bindingを維持する。
  接続成功のために認証要件を暗黙に弱めず、対応connectorとpublication有効化前のdependency probeで保証する。
  probeは更新用DBがread-write、分析参照用DBがread-onlyであることとRedisの疎通を検証する。
- アップロード画像は PNG/JPEG/WebP、1枚3MBまで、最大1920x1080。完全decode前にmagic bytesとformat headerからmedia type・寸法を検証し、上限超過やheader不整合を拒否する。
- OCR元画像は下書き確定または下書き削除まで保持し、その後削除する。DBに画像実体、内部path、長寿命URLを保存・公開しない。
- ログイン、OAuth callback state、画像アップロード、JSON mutation、CSV/TSV出力にはレート制限を入れる。
- JSON mutation の retry replay は rate limit / key数上限で潰さず、新規 mutation だけ account 別 rate limit と未期限切れ `Idempotency-Key` 件数上限を適用する。上限値は `AppConfig` / env で管理する。
- Discord OAuth provider の `429` / `5xx` / transport error が続く場合は短期 backoff で provider 呼び出しを抑制し、UIが扱える Problem Details と安全なログイベントへ正規化する。
- `/healthz` はAPIプロセスの生存確認。DB/Redis接続確認は詳細ヘルスとして分ける。公開HTTPを持たない
  分析workerはprocess生存、DB heartbeat、queue待機時間、job状態で観測する。
- 本番ログは1行JSONにする。
- 分析runtime imageはpackage manager、DB/Redis client、ptrace系debuggerをPATHまたは対応consoleから
  実行可能にしない。OCI entryは固定root bootstrapとし、workerおよび保守commandは権限降格後の非rootで実行する。
  障害時のconsole調査に必要なshell、process / cgroup / filesystem、DNS / TCP / TLSのread-only診断手段だけを
  残し、image smokeで実行可能性、特殊permission file不在、容量上限を固定する。

runtime / deploy 変更では `Dockerfile`、`deploy/`、`.github/workflows/deploy.yml`、
`scripts/ci/runtime-smoke.sh` を実装の現在状態として確認する。分析worker追加後はそのDockerfile、
deploy workflow、runtime smokeも確認する。公開文書には判断ルールだけを残し、provider設定や
攻撃面の詳細を写さない。
