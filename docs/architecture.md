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
- wake / publish は commit 後に実行する。rollback 時は post-commit effect を返さない。
- wake は業務 payload を持たない coalescing signal とし、永続 outbox row の代わりにしない。
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
- Page は composition とページ状態に寄せ、取得、mutation、複雑な状態機械、純粋変換を分離する。
- 複雑な Page は feature 固有の PageModel から resource、command、location、feedback など画面の意味を受け取り、TanStack Query の result や mutation object を直接受け取らない。PageModel 内は lifecycle と変更理由が異なる関心事だけを hook / 純粋変換へ分け、単なる転送層は作らない。
- ファイル行数は責務混在を見つける signal とし、行数だけを理由に浅い module へ分割しない。
- 本節を依存方向の正本とする。静的 gate へ投影する場合は `docs/dev-rule.md` の採用基準に従い、module graph から判定できる import 規則だけを syntax-aware な tool で検査する。本番コードから test 専用 module を参照しない。

### Server State

- server state は TanStack Query の cache lifecycle に従い、Page/UI component から query 基盤を直接操作しない。
- 結果確認の元画像も、取得状態とBlobをTanStack Queryが所有する。画像一覧と画像本体は異なるquery keyを持ち、本体は認証主体・画面scope・下書き・画像descriptorの世代を区別する。Object URLは画面の表示資源として生成・解放し、Blobや取得状態を別のcacheへ複製しない。
- 元画像の先読みは初回表示または利用者の画像選択に続く有限の処理として許可する。featureの取得処理が表示対象を優先して直列化し、同一取得の引継ぎ、中断、容量、scope終了時のquery破棄を所有する。自動retryや回線復帰による取得再開を起こさず、確定・削除成功時は関連cacheの更新より先に画像の寿命を閉じる。
- query key は cache 内の runtime data shape まで区別する。backend resource が同じでも raw response と ViewModel を同じ key に置かない。
- fatal error、再取得、cached data、認証待ち、disabled query を別状態として扱う。mutation 後は表示中の resource と選択候補の cache をともに整合させる。
- 初回表示、mutation 後の cache 整合、artifact 失効時の bounded recovery、利用者が実行した更新 / 再試行だけが server state の取得を開始する。interval、遅延 timer、window focus、tab visibility、network reconnect を起点に自動再取得しない。この契約は共通 QueryClient に集約し、feature ごとに再実装しない。
- React の concurrent / form API は cache、retry、認証、validation の既存契約を置き換えない範囲で使う。

### Client Lifecycle / Suspense / Motion

状態と表示補間の正本を次のように分離する。Motion は状態の視覚的な投影であり、application lifecycle の owner ではない。

| 関心事 | owner |
| --- | --- |
| server data、cache、refetch | TanStack Query |
| 楽観表示 | React `useOptimistic` または TanStack Query の mutation / cache のいずれか一方 |
| pending | Action、Transition、mutation など、その処理を開始した lifecycle |
| pathname、search params、navigation | React Router |
| dialog / disclosure の open、focus、keyboard | Base UI と owning shared UI primitive |
| DOM / SVG の補間、非対話的な exit snapshot | Motion |

- 同じ楽観表示を React `useOptimistic` と TanStack Query cache の両方で表現しない。一つの表示箇所だけなら action / mutation の入力から局所 overlay を導出し、複数 consumer の server state を揃える必要がある場合だけ cache update と snapshot / rollback を使う。pending から server response へ同じ対象を引き継ぐ場合は、client で安定した identity を発行し、表示順や Motion の layout identity を data identity の代わりにしない。
- Suspense は code / data readiness と fallback の presence を所有し、boundary は利用者に見せる loading sequence に合わせる。維持すべき dialog、tab list、toolbar、page surface は boundary の外に置き、その内部の未準備な body だけを fallback と置き換える。Motion や `AnimatePresence` で fallback と完成内容を crossfade せず、同じ primitive を loading 用と完成用に重複 mount して open / focus lifecycle を作り直さない。
- 異なる pathname は新しい route identity として、未準備なら route の structural fallback を表示する。同一 pathname の query key、filter、scope、sort、page の変更では、通常 query、Transition、deferred value など所有する state layer の手段で既存内容を維持し、Motion に待機や切替を決めさせない。
- 有限で局所的な motion の標準実装は Motion for React とする。app の一つの provider で同期 `LazyMotion`、animation と renderer だけを含む `domMin`、`strict`、`m` component を構成し、`MotionConfig reducedMotion="user"` を基準にする。`motion` component、`domAnimation` / `domMax` の gesture feature、layout / shared layout、drag / pan は初期 scope に含めず、必要性、操作契約、bundle 差分、主要 device の実測を伴う別の architecture decision とする。
- Motion の宣言は、変化する pixel と semantic state を所有する shared UI primitive または feature の末端 visual component に置く。PageModel、resource / command / query hook、router は Motion を import しない。`Fade`、`Slide`、`Scale` のように effect 名だけを隠す pass-through wrapper は作らず、複数用途の accessibility、state mapping、interruption を一つの小さい契約で隠せる場合だけ shared abstraction にする。
- application code は Motion の完了 callback を、data、cache、route、open、focus、pending、error、操作可能性を進める唯一の条件にしない。callback が所有してよいのは、中断または未実行でも application state を誤らせない冪等な表示上の後始末に限る。exit のため一時保持する node は非対話的かつ accessibility tree の対象外とし、先に確定した state と focus を巻き戻さない。
- presence による一時保持は、shared dialog と toast が通常の close / remove 後に非対話的な exit snapshot を描く場合だけ許可する。親 subtree、route、artifact、view の identity が失われた場合は exit を省略してよく、表示補間のためにそれらの lifecycle を遅らせない。
- 処理時間が不定な Spinner / Skeleton の loop だけは shared loading primitive 内の CSS を使ってよい。それ以外の新しい有限 motion は Motion に統一し、同じ transition に CSS、timer、Web Animations API、別の motion engine を混ぜない。Motion 導入時は既存の有限 CSS transition もこの境界へ移し、CSS loop の feature 直書きを shared loading primitive へ集約する。
- `MotionConfig reducedMotion="user"` が transform / layout を無効にしても opacity や color は残り得るため、非必須の残存 motion は末端 component でも省略する。Motion の初回導入と feature bundle の変更では production build の bundle 差分を測る。使用 API と import 境界は、標準 lint で一意に判定できる範囲だけを静的検査へ投影する。

### Form / React 19 / API Client

- event 由来の値は handler 内で同期的に取り出し、request transform で route / prefill / hidden identifier を落とさない。
- 分析の集計、意味を持つ sort / filter、閾値、統計 fallback は Web で再計算せず、保存済み成果物を表示用に整形する。

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

### OCR Capability / Worker Role

- OCR の object / queue / 状態契約は `docs/redis-streams-ocr-contract.md` と schema を正本とし、URL、credential、local path を runtime 間 payload にしない。

## 5. Runtime / Security

- secret、session / CSRF token、接続 URL、画像内容、OCR raw text、分析成果物本文をログへ出さない。例外は安全な分類情報へ正規化する。
- production の DB / Redis は暗号化と相手検証を維持し、接続のために認証要件を暗黙に弱めない。
- upload は許可形式、byte 数、寸法、内容 fingerprint を完全 decode 前後の境界で検証し、画像実体や長寿命 URL を DB / 公開 DTO に置かない。
- health、dependency readiness、機能応答、resource / performance を別の証拠として扱う。
- stream response は handler 完了ではなく転送終了時に success / error / cancel と byte 数を exactly once 観測する。
- runtime image は最小権限で動かし、診断手段を残す場合も provider 設定や攻撃面を public docs へ複製しない。
