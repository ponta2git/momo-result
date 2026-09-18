# アーキテクチャ規約

目的: API、Web、Processing Worker の責務と依存方向を判断する。現在の型、設定、コマンドは実装、wire payload の shape / limit は対応する endpoint または schema を正本とし、この文書へ複製しない。

業務意味は `docs/domain-rule.md`、DB は `docs/db-rule.md`、OCR queue は `docs/redis-streams-ocr-contract.md`、戦績分析の横断要求は `docs/requirements/series-analysis-batch.md`、UI は `docs/ui-rule.md` を参照する。

## 1. System Boundaries

| 境界 | 責務 | 正本 |
| --- | --- | --- |
| Web | SPA、入力、表示、画面状態 | `apps/web/src/` |
| API | HTTP、認証、usecase、DB / queue adapter | Tapir endpoint、`apps/api/` |
| Processing Worker | OCR / 分析の非同期実行、lease、外部I/O | `apps/processing-worker/` |
| DB | 業務状態、job、outbox、成果物 | `../momo-db` migration |
| Redis Streams | job の配送 | schema と queue 契約文書 |
| public HTTP runtime | Web 配信、API、reverse proxy | `Dockerfile`、`deploy/`、runtime tool |

- public HTTP runtime に OCR / 分析処理を同居させず、HTTP request 内で高負荷分析を実行しない。
- DB を状態の正本、Redis Streams を再配送可能な配送路とする。
- provider 固有値、resource 実測値、secret、運用手順は public docs に置かない。

## 2. API

### Wire Boundary

- HTTP 契約は Tapir endpoint を正本とする。手書き route が必要でも path / query / header を二重管理しない。
- 分析artifactのraw response shapeは、Rust所有のartifact schemaとAPI所有のmetadata projectionをTapirのnamed responseへ合成してHTTP契約とする。OpenAPI、Web型、runtime validatorはこの合成結果から生成し、派生物へshapeを手書きしない。
- `apps/api/openapi.yaml` は内部 Web codegen 用の追跡する派生物であり、契約や公開 API documentation の正本ではない。Tapir から一時生成した spec を保守された OpenAPI-aware linter で構造検証し、tracked artifact と一致させ、その artifact から Web 型を生成する。手編集で差分を解消しない。
- OpenAPI lint は unresolved reference、path / parameter、schema、operation identity など構造整合性に限定する。field の公開可否、認証、業務意味は endpoint、DTO、要求・domain 規約で決め、legacy 名や source 断片の文字列検査を契約にしない。
- HTTP 層は入力・認証・エラー変換に閉じ、DB、Redis、業務分岐を直接持たない。
- Tapirのserver logicで発生した例外は外側の`HttpErrorMiddleware`へ伝え、共通のProblem Detailsと機密情報を除いたincident logに変換する。Tapirの既定例外応答・例外logと二重に処理しない。mutationの結果不明時に保持するidempotency予約は、このHTTP変換より内側で確定する。
- raw ID、設定値、wire value は境界で検証済み型へ変換する。usecase へ未検証値や wire DTO を渡さない。
- optional field が mode や副作用を変える場合は discriminator として要件または domain 文書にも意味を残す。
- 外部依存は port と adapter で隔離し、composition root だけが実装を選ぶ。

### Usecase / Repository

- usecase は状態遷移、整合性、副作用を所有し、repository は永続化契約に閉じる。
- 通常制御フローは型で返し、予期しない不整合や外部I/O失敗と区別する。
- 部分更新は既存値と入力を合わせた実効状態で検証する。読み取り後の前提を更新に使う場合は、同じ更新条件で再検証する。
- in-memory adapter は production adapter と同じ状態遷移 guard を持つ。単純化した double を正本にしない。
- 分析読み取りは保存済み成果物を返すだけにし、関連する読み取りを同じ artifact version へ固定する。詳細は `docs/requirements/series-analysis-batch.md` を正本とする。

### Transaction / Outbox

- 業務状態と outbox は同じ DB transaction で確定し、Redis publish は transaction の成功条件にしない。
- 下書き・試合の変更に伴うDiscord通知取消も同じsource commandへ含める。transactionの集約単位とlock順はアプリに明示し、通知triggerで暗黙に補完しない。詳細は`docs/db-rule.md`を参照する。
- 管理者のDiscord通知設定はAPIのapplication commandとして扱う。domainが世代競合と変更・取消対象を決め、PostgreSQL adapterがgate取得、最新状態の読取り、設定と取消の一括保存を行う。DBは永続化と排他を担い、Summitの稼働は設定保存の前提にしない。
- wake / publish は commit 後に実行する。rollback 時は post-commit effect を返さない。
- wake は業務 payload を持たない coalescing signal とし、永続 outbox row の代わりにしない。
- API の commit 後 handoff は process-local wake までとし、外部通知の I/O は Resource が所有する coordinator で実行する。通知の遅延・失敗で確定済み更新の応答を待たせず、再試行と停止は coordinator、通知喪失後の回収は durable outbox の consumer が所有する。
- dispatcher は startup recovery、bounded drain、retry deadline、backoff を扱い、無条件の短周期 polling をしない。
- append 後の DB 更新失敗や重複配送を許容し、claim / fence と冪等な consumer で収束させる。
- 分析ではAPIとrelease controllerをdurable intentのwriter、Processing Workerをcampaign展開からRedis append、delivery mark / retryまでの単一dispatcher ownerとする。writerはcommit時にpayloadless hintだけを送り、workerはhint喪失を低頻度のbounded recoveryで収束させる。
- PostgreSQLのsession stateへ依存する分析outbox listenerは、通常query用のtransaction-pooled接続と設定を分離したsession-capable接続を所有する。workerは別接続からの通知round tripをstartup readiness前に確認し、`LISTEN`文の成功だけを機能成立と扱わない。

### Error / Auth

- 業務、認証、権限、入力、外部依存のエラーを区別し、UI が扱える Problem Details へ正規化する。
- OAuth provider、account、session、provider backoff は auth service に閉じる。HTTP module は cookie / redirect / wire 変換を担う。
- 認証主体と試合参加者を混同しない。状態変更 API は CSRF 対策を必須とし、dev/test 認証を本番経路へ混ぜない。
- UI が回復方法を変える HTTP status を汎用内部エラーへ潰さない。

## 3. Web

### Layering

- `apps/web/src` の依存方向は `app -> features -> shared` とする。逆方向 import と feature 間の実装詳細 import を禁止する。
- `shared` は横断 API、生成型の facade、query 基盤、共有 UI、共通 domain helper を所有する。画面固有の状態・変換・UI は feature に置く。
- `shared` 内も依存方向を持つ。下表の基盤から業務別の adapter へ逆依存しない。型だけの import も同じ境界で扱う。

  | モジュール | 所有する判断 | 依存できる shared 基盤 |
  | --- | --- | --- |
  | `lib` | 業務に依存しない値変換・局所的な React / browser utility | `lib` |
  | `domain` | 業務語彙、identity、入力順、純粋な変換 | `domain`、`lib` |
  | `api` | HTTP、wire decode、query key / cache、idempotency | `api`、`domain`、`lib` |
  | `ui` | 汎用の構造・操作・アクセシビリティ・表示補間 | `ui`、`lib` |

  `shared/matches`、`heldEvents`、`masters`、`navigation` などの業務別 module はこれらを組み合わせる。順位・メンバー identity を知る結果台帳は `shared/matches`、API の候補を選択部品へ接続する処理は `shared/heldEvents`、分析専用チャートは `features/seriesComparison` が所有する。配置名が shared であることを汎用性の根拠にしない。
- Page は composition とページ状態に寄せ、取得、mutation、複雑な状態機械、純粋変換を分離する。
- 複雑な Page は feature 固有の PageModel から resource、command、location、feedback など画面の意味を受け取り、TanStack Query の result や mutation object を直接受け取らない。PageModel 内は lifecycle と変更理由が異なる関心事だけを hook / 純粋変換へ分け、単なる転送層は作らない。
- hook が計算済みの値を別の builder へ渡し、そのまま同じ画面モデルへ詰め直す層は置かない。子の契約は使用する値・操作だけで表し、設定欄へ全 player 入力、チャートへ全 artifact、command へ全 page model を運ばない。純粋な表示変換・型は hook や page component へ依存せず、consumer と取得処理の共通の下位に置く。
- ファイル行数は責務混在を見つける signal とし、行数だけを理由に浅い module へ分割しない。
- 本節を依存方向の正本とする。静的 gate へ投影する場合は `docs/dev-rule.md` の採用基準に従い、module graph から判定できる import 規則だけを syntax-aware な tool で検査する。本番コードから test 専用 module を参照しない。

### Server State

- server state は TanStack Query の cache lifecycle に従い、Page/UI component から query 基盤を直接操作しない。
- 結果確認の元画像も、取得状態とBlobをTanStack Queryが所有する。画像一覧と画像本体は異なるquery keyを持ち、本体は認証主体・画面scope・下書き・画像descriptorの世代を区別する。Object URLは画面の表示資源として生成・解放し、Blobや取得状態を別のcacheへ複製しない。
- 元画像の先読みは初回表示または利用者の画像選択に続く有限の処理として許可する。featureの取得処理が表示対象を優先して直列化し、同一取得の引継ぎ、中断、容量、scope終了時のquery破棄を所有する。自動retryや回線復帰による取得再開を起こさず、確定・削除成功時は関連cacheの更新より先に画像の寿命を閉じる。
- query key は cache 内の runtime data shape まで区別する。backend resource が同じでも raw response と ViewModel を同じ key に置かない。
- consumer の射影は `select` または純粋な表示変換で行い、cache は元の server data を保持する。表示中の data が現 query の値か前 scope の placeholder かは query observer の状態から判断し、その判定のために描画時に cache を別途読み直さない。
- fatal error、再取得、cached data、認証待ち、disabled query を別状態として扱う。mutation 後は表示中の resource と選択候補の cache をともに整合させる。
- 初回表示、mutation 後の cache 整合、artifact 失効時の bounded recovery、利用者が実行した更新 / 再試行だけが server state の取得を開始する。interval、遅延 timer、window focus、tab visibility、network reconnect を起点に自動再取得しない。この契約は共通 QueryClient に集約し、feature ごとに再実装しない。
- React の concurrent / form API は cache、retry、認証、validation の既存契約を置き換えない範囲で使う。

### React 更新の優先度

- 入力値、選択 intent、focus は即時に反映する。`useDeferredValue` は追従を遅らせてもよい検証表示・一覧・図表に使い、送信時の validation と request は最新値から同期的に組み立てる。
- 遅延する表示は `memo` と安定した props の境界を組み合わせ、urgent render で前の重い subtree を再描画しない。小さい値の加工へ一律に memo を足さず、state の局所化・不要な依存の削減を先に検討する。deferred value は debounce、通信回数の制限、計算量の削減ではない。
- 表示 bundle を遅延する場合は data、scope、view の identity を一緒に保つ。要求中の条件を古い図表の見出し・操作へ混ぜず、追従中の表示と操作制限は既存の stale 表示へ接続する。
- `useOptimistic` の更新は Action 内で行い、操作に属する非同期処理を await する。navigation の Promise は Router の完了境界であり、任意の `React.lazy` subtree の描画完了を保証しない。取得は Query、code readiness は Suspense が引き続き所有する。
- 作成結果を楽観表示する場合、成功 response を Query cache の確定値へ引き継いでから再取得する。再取得だけに確定を任せず、保存成功後の再取得失敗を作成失敗へ巻き戻さない。失敗した Action は入力を残し、成功時だけ明示的に初期化する。

| 対象 | 採用する更新境界 | 理由 |
| --- | --- | --- |
| 試合一覧の条件変更 | 即時の選択 intent、遅延した一覧、古い対象への操作制限 | 続けて条件を変えながら表示を追従させる |
| 戦績比較の view / scope / artifact | 整合した表示 bundle の遅延、図表の memo 境界 | 大きい図表更新を選択操作と分離する |
| 試合入力 | 数値入力の局所 draft、遅延検証、score grid の描画境界 | メモ・設定の編集が無関係な grid を再描画しない |
| マスタ作成 | Action と局所的な楽観行、成功 response の確定反映 | 待ち時間中も追加を示し、失敗時に入力を回復する |
| 保存・削除・OCR開始・権限/通知変更・再計算・出力 | Action / mutation の pending と確定結果 | 検証、競合、副作用、生成結果を先取りしない |
| 開催一覧・出力候補のページ取得 | Query の前ページ保持と scope 表示 | ページ単位の取得は既存の待機境界で扱える |

設定管理の訪問済み panel は Base UI の `keepMounted` で入力・DOM を保持する。React `Activity` は hidden subtree の Effects を停止するが、現在の Query / Action owner は panel の外にあるため、主要な取得・描画負荷を移せない。focus / dialog 接続の再作成も伴うので、この構造では追加しない。

API の判断は React の [useDeferredValue](https://react.dev/reference/react/useDeferredValue)、[useTransition](https://react.dev/reference/react/useTransition)、[useOptimistic](https://react.dev/reference/react/useOptimistic) と TanStack Query の [mutation response による更新](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses) を参照する。効果は不要な render の削減と待機中の操作で確認し、通信速度や処理時間の短縮とは区別する。

### Client Lifecycle / Suspense / Motion

状態と表示補間の正本を次のように分離する。Motion は状態の視覚的な投影であり、application lifecycle の owner ではない。

| 関心事 | owner |
| --- | --- |
| server data、cache、refetch | TanStack Query |
| 楽観表示 | React `useOptimistic` または TanStack Query の mutation / cache のいずれか一方 |
| pending | Action、Transition、mutation など、その処理を開始した lifecycle |
| 操作と結果の通知単位・発火、inline feedback の継続条件 | 操作を所有する feature。表示先の選択は UI 規約に従う |
| 通知の描画・読み上げ、toast の表示寿命 | shared UI。画面をまたぐ toast は app に置く共通 host |
| pathname、search params、navigation | React Router |
| dialog / disclosure / select の open、focus、keyboard | Base UI と owning shared UI primitive |
| DOM / SVG の補間、非対話的な exit snapshot | Motion |

- 同じ楽観表示を React `useOptimistic` と TanStack Query cache の両方で表現しない。一つの表示箇所だけなら action / mutation の入力から局所 overlay を導出し、複数 consumer の server state を揃える必要がある場合だけ cache update と snapshot / rollback を使う。pending から server response へ同じ対象を引き継ぐ場合は、client で安定した identity を発行し、表示順や Motion の layout identity を data identity の代わりにしない。
- 表示準備、操作制限、通知は別の境界として設計する。表示準備は未準備な code / data と置換する body、操作制限は処理中の重複・競合操作、権限・前提条件、表示中と要求中の scope の違いから誤操作を招く範囲、通知は一つの利用者操作とその結果を成立させる取得のまとまりを扱う。query や親子 component ごとに同じ待機表示を生成せず、feature composition が既存の取得・操作状態から表示担当を導出する。通知の集約を理由に query を結合したり、独立した結果・失敗を一つの global pending に潰したりしない。
- Suspense は code / data readiness と fallback の presence を所有し、boundary は利用者に見せる loading sequence に合わせる。一度表示した dialog、tab list、toolbar、page surface の lifecycle を、その内部の body の待機から分離する。Suspense を使う場合は維持する部分を該当 boundary の外に置き、未準備な body だけを fallback と置き換える。最初の route module 自体が未準備な場合は route の structural fallback を使う。Motion や `AnimatePresence` で fallback と完成内容を crossfade せず、同じ primitive を loading 用と完成用に重複 mount して open / focus lifecycle を作り直さない。
- 異なる pathname は新しい route identity として、未準備なら route の structural fallback を表示する。同一 pathname の query key、filter、scope、sort、page の変更では、通常 query、Transition、deferred value など所有する state layer の手段で既存内容を維持し、Motion に待機や切替を決めさせない。
- 通常 query と Suspense query は、前条件の data 保持、部分失敗、独立した回復、安定した操作領域をどちらが簡潔に表現できるかで選ぶ。Suspense 採用を refetch 中の fallback 表示と同一視しない。待機表示の整理だけを理由に取得方式を置き換えず、boundary や content の identity を pending の切替で作り直さない。
- toast は feature が確定した実行結果から発火し、render、汎用 query observer、cache invalidation ごとの成功通知にしない。通常の route content の境界から共通 host を分離し、rendererはhostと同期で準備する。最初の通知から同じ描画経路を使い、準備用表示との交換で見た目・focus・表示寿命を作り直さない。通知の一意性は実行結果に結び付け、server state や操作の完了判定を toast の状態に移さない。
- 有限で局所的な motion の標準実装は Motion for React とする。app の一つの provider で同期 `LazyMotion`、animation と renderer だけを含む `domMin`、`strict`、`m` component を構成し、`MotionConfig reducedMotion="user"` を基準にする。`motion` component、`domAnimation` / `domMax` の gesture feature、layout / shared layout、drag / pan は初期 scope に含めず、必要性、操作契約、bundle 差分、主要 device の実測を伴う別の architecture decision とする。
- 面のhoverはshared UIの`useSurfaceFeedback`がnative DOMのpointer進入・離脱・cancelを観測し、Motion `animate`で内部のhover量だけを補間する。CSSは意味に対応した色対と、pressed・focus・操作制限の即時表示を所有する。click、keyboard、選択、openをこの接続で再実装しない。Motionのhover gestureは押下中のleaveを遅らせるため、この用途では使わず、`domMin`を維持する。有限CSS transitionの例外は設けない。外部refの接続・cleanupと動きを減らす設定の変更も接続側が扱い、画面へ時間・色・hover状態を公開しない。
- Motion の宣言は、変化する pixel と semantic state を所有する shared UI primitive または feature の末端 visual component に置く。PageModel、resource / command / query hook、router は Motion を import しない。`Fade`、`Slide`、`Scale` のように effect 名だけを隠す pass-through wrapper は作らず、複数用途の accessibility、state mapping、interruption を一つの小さい契約で隠せる場合だけ shared abstraction にする。
- application code は Motion の完了 callback を、data、cache、route、open、focus、pending、error、操作可能性を進める唯一の条件にしない。callback が所有してよいのは、中断または未実行でも application state を誤らせない冪等な表示上の後始末に限る。exit のため一時保持する node は非対話的かつ accessibility tree の対象外とし、先に確定した state と focus を巻き戻さない。
- presence による一時保持は、shared dialog と toast が通常の close / remove 後に非対話的な exit snapshot を描く場合だけ許可する。親 subtree、route、artifact、view の identity が失われた場合は exit を省略してよく、表示補間のためにそれらの lifecycle を遅らせない。
- 処理時間が不定な Spinner / Skeleton の loop だけは shared loading primitive 内の CSS を使ってよい。それ以外の新しい有限 motion は Motion に統一し、同じ transition に CSS、timer、Web Animations API、別の motion engine を混ぜない。Motion 導入時は既存の有限 CSS transition もこの境界へ移し、CSS loop の feature 直書きを shared loading primitive へ集約する。
- `MotionConfig reducedMotion="user"` が transform / layout を無効にしても opacity や color は残り得るため、非必須の残存 motion は末端 component でも省略する。Motion の初回導入と feature bundle の変更では production build の bundle 差分を測る。使用 API と import 境界は、標準 lint で一意に判定できる範囲だけを静的検査へ投影する。

### Form / React 19 / API Client

- event 由来の値は handler 内で同期的に取り出し、request transform で route / prefill / hidden identifier を落とさない。
- 分析の集計、意味を持つ sort / filter、閾値、統計 fallback は Web で再計算せず、保存済み成果物を表示用に整形する。
- OCR の開始確認では設定・画像と送信する作品ヒントを同じ snapshot に固定する。API がジョブ受付時に既定のプレーヤー別名、登録済み別名、作品方式ごとの CPU 名を補完し、補完後の payload 上限も検証する。Web はそのための別名取得・正規化・上限処理を持たない。既存 OCR 結果から編集フォームを復元する名前解決は、入力支援として Web に残す。

### API / UI Boundary

- Web の API 型は生成物を直接 feature へ漏らさず、`shared/api` の用途別 facade を介す。
- credential、CSRF、Problem Details、idempotency は共通 client で扱う。同一 mutation の retry は同じ操作 key を再利用し、payload が変われば新しい key にする。
- UI の意味表現と操作契約は `docs/ui-rule.md` を正本とする。shared UI と semantic token から外れる実装は、利用者に現れる意味・状態・操作への影響で review し、source 表記だけを一律の適合判定にしない。

## 4. Processing Worker

### Process Boundary

| 関心事 | parent process | attempt child process |
| --- | --- | --- |
| 外部I/O | DB、Redis、object storage、queue を所有 | 分析の read-only snapshot 以外を持たない |
| lifecycle | claim、lease / fence、spawn、制限、timeout、停止、reap | 1 attempt だけを実行する |
| 出力 | candidate を検証し、transaction で初めて確定する | bounded で非 authoritative な candidate を返す |
| 完了 | durable commit、post-commit effect、delivery disposition | job 終端、公開、ACK、outbox を変更しない |

- Analysis / OCR は同じ parent lifecycle を共有し、能力固有の入力 transport と計算だけを分ける。
- capability crate は決定論的な domain / 計算 / version 付き論理契約を所有し、DB、Redis、filesystem、clock、async runtime に依存しない。runtime から capability への一方向依存とする。
- production の OS FFI と `unsafe` は process adapter に隔離し、他 module へ checked な safe API を公開する。
- 子 process の resource 制限は実 runtime の cgroup で保証する。非対応 OS では job claim 前に fail closed にする。
- 同時実行や publication は DB lease と fencing token で世代をまたいで保証する。process 内 semaphore や台数を正本にしない。
- 子 process の成果物は上限、path、件数、schema、checksum を親が検証し、失敗時に部分公開しない。
- 分析worker内のRust validatorをpayload意味、canonical encoding、resource集合・相互参照の単一ownerとする。parentは完全検証を通ったopaque artifactだけをversion付きで公開し、APIはそのimmutable publication attestation、生成schema、reader resource上限、request identityだけを独立に検証する。
- 分析release controllerはactiveなalgorithm / artifact schema / validation contract singletonと全titleへのpromotionを所有する。API / workerのcapability registryを検査中だけ凍結し、互換判定とdesired-state切替の間へ別世代を割り込ませない。
- 入力 version、algorithm version、artifact schema version を別の型として扱い、同じ入力と algorithm version では決定論的にする。
- OCR だけが分析を preempt できる。共有実行枠、再queue、失敗回数、公開の詳細は `docs/requirements/series-analysis-batch.md` を正本とする。

- 分析完了通知は `notifications/analysis` が前後のimmutable成果物を比較し、公開transaction末尾で表示metadataを固定する。通知準備はOCRと同じ回復可能なSAVEPOINT境界を使い、正常commitを確認した経路だけが共通senderへ渡す。分析child・API・Summitに平均計算やproducer送出の責務を移さない。内容と比較範囲は `docs/requirements/series-analysis-batch.md` を参照する。
- 比較用の成果物取得は通知に必要な保存済みplayer metricsだけを射影し、通知で使わない分析カードを転送しない。元成果物のbyte・件数上限とtyped decode、前後のidentity・scope整合性は維持する。比較準備の時間枠には接続確立と全DB往復を含め、確定transaction内の準備とともに親の絶対期限から業務commit・復旧の余裕を残す。比較取得のtimeoutと、確定直前の残時間不足は別の省略理由として記録する。

### OCR Capability / Worker Role

- OCR の object / queue / 状態契約は `docs/redis-streams-ocr-contract.md` と schema を正本とし、URL、credential、local path を runtime 間 payload にしない。
- OCRの不確かな読取値は、必要な警告を保持して要確認結果として保存する。件数の妥当性しきい値を保存拒否の上限に読み替えず、parserと保存前検証で警告条件を一致させる。構造・型・対応関係が壊れた候補や警告の欠落は拒否する。
- OCR・分析通知のenvelopeは `notifications/envelope` が種類・論理job IDから通知IDとwire versionを一括で構築する。各producerは固定dataと成功時刻・世代を渡し、型ごとにIDやversionを組み立て直さない。送出可否と成功commit後のhandoffは引き続き制御側が所有する。
- OCR完了通知は画像ごとの検証済み結果から作り、他のslotを含む下書きの投影状態には依存しない。成功transactionの業務更新をすべて終えてから共有result gateと設定を読み、ONの場合だけ成功時点の識別子・文脈・警告有無を固定する。共有wireと排他契約は `../momo-db/docs/discord-notifications.md` を正本とする。
- 通知準備は確定処理と同じ絶対期限から残り時間を計算し、実行中SQLの終了・SAVEPOINT復旧・業務commitの時間を確保する。余裕がなければ通知用SQLを実行せず、復旧可能な準備失敗では業務成功を保って通知を省略する。commit成功後だけ、件数・bytes・同時接続数に上限を持つ共通senderへ渡す。OCRのACK・実行枠解放はHTTP完了を待たない。
- senderはDNS・接続・応答を含む単一のrequest期限内で一度だけHTTPを試み、整合する受付応答を永続受付の証拠として扱う。接続だけを先に打ち切る短い期限を重ねず、TCPの一時的な停滞からの回復も同じ期限に含める。応答不明時も通知outbox・再試行・再起動時の再構築は行わない。停止時はproducerの確定を優先し、残りの共通期限で通知をdrainする。

## 5. Runtime / Security

- secret、session / CSRF token、接続 URL、画像内容、OCR raw text、分析成果物本文をログへ出さない。例外は安全な分類情報へ正規化する。
- production の DB / Redis は暗号化と相手検証を維持し、接続のために認証要件を暗黙に弱めない。
- upload は許可形式、byte 数、寸法、内容 fingerprint を完全 decode 前後の境界で検証し、画像実体や長寿命 URL を DB / 公開 DTO に置かない。
- health、dependency readiness、機能応答、resource / performance を別の証拠として扱う。
- stream response は handler 完了ではなく転送終了時に success / error / cancel と byte 数を exactly once 観測する。
- runtime image は最小権限で動かし、診断手段を残す場合も provider 設定や攻撃面を public docs へ複製しない。
