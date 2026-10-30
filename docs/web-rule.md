# Web 実装規約

目的: `apps/web` の層、server state、React の更新境界、client lifecycle と motion、form / API client、build / test tooling の実装契約を定める。表示の意味、視覚階層、操作文法、文言は [UI 規約](ui-rule.md) が所有する。現在の component / module / token 名は実装を正本とし、主要な実装への入口は本書の [Implementation Entry Points](#implementation-entry-points) から辿れる。

wire は [API 規約](api-rule.md#wire-boundary)、分析の Web state 契約は [分析 batch 要求](requirements/series-analysis-batch.md#web-state)、品質証拠は [テスト・品質規約](test-rule.md#web-evidence-catalog)、実行境界は [テスト実行設計](test-architecture.md#web-の実行境界) を参照する。

## Layering

- `apps/web/src` の依存方向は `app -> features -> shared` とし、`shared` 内も業務別 module から基盤への一方向とする。import の可否（feature 間、shared 基盤間、型 import、test support、generated・Base UI・Query・Motion の入口）は `apps/web/oxlint.config.ts` が検査する。
- `shared` は横断 API、生成型の facade、query 基盤、共有 UI、共通 domain helper を所有する。画面固有の状態・変換・UI は feature に置く。shared 基盤の所有する判断は次のとおり。

  | モジュール | 所有する判断 |
  | --- | --- |
  | `lib` | 業務に依存しない値変換・局所的な React / browser utility |
  | `domain` | 業務語彙、identity、入力順、純粋な変換 |
  | `api` | HTTP、wire decode、query key / cache、idempotency |
  | `ui` | 汎用の構造・操作・アクセシビリティ・表示補間 |

  `shared/matches`、`heldEvents`、`masters`、`navigation` などの業務別 module はこれらを組み合わせる。順位・メンバー identity を知る結果台帳は `shared/matches`、API の候補を選択部品へ接続する処理は `shared/heldEvents`、分析専用チャートは `features/seriesComparison` が所有する。配置名が shared であることを汎用性の根拠にしない。
- すべての feature で、入口が処理の流れを組み立て、純粋な model が判断・変換を、owner が状態・入出力・寿命を、UI が表示と利用者の操作を担当する。規模によって変えるのは分割量であり、この責務分担ではない。
- 画面の合成 hook は選択、整合した表示結果、編集、保存などの owner を組み合わせ、画面全体に必要な値だけを購読する。各表示領域は必要な readonly view と意味のある操作を受け取り、Query result、mutation object、内部 session、任意 updater、業務状態を書き換える ref を受け取らない。小さい機能は同じファイルの名前付き関数で分けてよく、層の数と名前は機能の規模に合わせる。
- 入力の正規化、選択の遷移、初期化、取得・保存可否、結果の採用、表示への変換は、値を受けて結果を返す純粋な model で読めるようにする。URL の読み書き、query、保存、時刻の取得と状態への反映は対応する owner が扱う。同じ更新の判断と反映は、その状態を所有する境界にまとめる。未解決・利用不可・利用可能など意味の異なる結果を型で区別し、通信中かどうかは別に扱う。外部入力や応答の対象・世代の一致は実行時にも検証する。
- 最新状態の読取り、純粋な遷移・実行判断、commit と入出力への接続は、対象の状態を所有する境界に閉じる。一緒に整合を守る入力・確認状態は一度に更新し、独立した取得・送信・表示資源まで一つの owner に集めない。owner の寿命と購読範囲は別に決め、表示を分割しても進行中の操作や編集の所有期間を保つ。
- 戦績比較は URL を確定した選択の正本とし、要求中・確認済み・表示中の条件を区別する。URL の目的は、作品・season・map・表示する節・選択指標などの確定した条件を、認証済みの有効な account が別端末やブラウザーの戻る操作で共有・復元できるようにすることである。公開共有の手段にはせず（[比較要求](requirements/series-comparison.md#1-product-scope)）、状態遷移のすべてを URL で管理することも目的にしない。選択は候補との整合と URL 更新、結果は取得した成果物の採用と表示、見通しセッションは採用済み要約と試算入力をそれぞれ所有する。試合一覧の更新も対象付きの読取結果を選択へ渡し、URL の更新は選択に任せる。
- hook が計算済みの値を別の builder へ渡し、そのまま同じ画面モデルへ詰め直す層は置かない。子の契約は使用する値・操作だけで表し、設定欄へ全 player 入力、チャートへ全 artifact、command へ全 page model を運ばない。純粋な表示変換・型は hook や page component へ依存せず、consumer と取得処理の共通の下位に置く。
- ファイル行数は責務混在を見つける signal とし、行数とは別に責務のまとまりを確かめて分割を判断する。
- 層と所有は責務分離によって Web 全体の統率を保つための設計であり、本節を正本とする。個々の import の許可の現在値は oxlint 設定を正本とし、設定は本節の意図のうち module graph から一意に判定できる import 規則だけを投影する。shared の安定した基盤へ別の shared module を通じて application policy が入り込まないようにすることも、設定コメントが示す目的である。lint 設定の変更だけで層の責務を変えたことにはせず、意図を変える場合は本節も同じ変更で見直す。採用基準は [Change Gates](dev-rule.md#change-gates) に従う。

## Implementation Entry Points

UI 規約は原則として役割で規則を書き、本表は役割から現在の実装へ進む入口である。全実装名の登録簿ではなく、要求が特定の primitive を指名する場合や、CSS utility のように役割名より具体名が短く正確な場合は、UI 規約・要求から直接参照してよい。名前の現在値は実装を正本とする。改名・移動時は本表に加え、その名前を直接参照する文書とコードも更新する。

| 役割（UI 規約の呼称） | 現在の実装入口 |
| --- | --- |
| page frame / page-level content surface と幅 variant（narrow / standard / wide / workspace）、内余白なしの variant | `PageFrame`、`PageContentSurface`（`padding="none"`） |
| 共通の readable measure | `max-w-2xl` |
| 文字色の呼称 `text-primary` / `text-body` / `text-secondary` / `text-muted` | `styles.css` の `--color-text-primary` / `--color-text-body` / `--color-text-secondary` / `--color-text-muted` |
| 文字ウェイト token と utility | global stylesheet `styles.css` |
| 共通文字 recipe（主要結論 `primary`、一覧用主要結果 `compactPrimary`、入力文字 `fieldText`） | `shared/ui/typography.ts` |
| field / fieldset | `shared/ui/forms/Field.tsx` の `Field`、native `<fieldset>` |
| 通常・invalid の境界 recipe と control の tone 優先順位 | `shared/ui/forms/controlPresentation` |
| 一行 Select primitive | `shared/ui/forms/SelectControl.tsx` の `SelectControl`、field 接続は `SelectField`。内部で Base UI Select を使う |
| disclosure primitive と展開 panel | `shared/ui/data/Collapsible.tsx` の `Disclosure`。内部で Base UI Collapsible を使う |
| 確認 dialog | `AlertDialog` |
| label / value 表示 pattern | `FactList` |
| 共通 data table primitive と table scroll area | `DataTable`、`TableScrollArea` |
| 内容群と操作群を並べる pattern | `ContentWithActions` |
| task action panel の presentation | `taskActionPanelClass` |
| 前後移動 primitive | `AdjacentNavigation` |
| プレー順 marker、member sequence label | `PlayOrderMark`、`MemberSequenceLabel` |
| 面の hover feedback hook | `useSurfaceFeedback` |
| 共通 QueryClient と自動再取得の契約 | `app/queryClient.ts` の `queryClient` |
| 共通の許可判断と本人情報 | `shared/auth` |
| 画面をまたぐ toast の共通 host | `shared/ui/feedback/ToastHost.tsx` の `ToastHost`。`app/AppShell.tsx` が配置する |
| Motion provider | 同期 `LazyMotion` + `domMin` + `strict` + `m` component、`MotionConfig` |
| 共通 test factory / MSW reset | `apps/web/src/test/factories/`、`apps/web/src/test/msw/handlers.ts` の `resetMswStores` |

## Server State

- server state は TanStack Query の cache lifecycle に従う。
- 取得・保存担当の公開契約は用途別の data、取得・操作状態、結果、操作に絞る。Query result、mutation object、QueryClient、query key、再取得 options を業務判断や編集状態へ渡さない。キャッシュ通知・更新・破棄と再取得の実装は取得・保存 adapter に閉じ、認可の所有期間、結果の採用、競合解消などの判断はその契約を通して行う。同じファイルの名前付き関数でも境界は表せるため、endpoint ごとの中継や Query API を写した汎用 wrapper は増やさない。
- 結果確認の元画像も、取得状態と Blob を TanStack Query が所有する。画像一覧と画像本体は異なる query key を持ち、本体は認証主体・画面 scope・下書き・画像 descriptor の世代を区別する。Object URL は画面の表示資源として生成・解放し、Blob と取得状態の cache の owner は TanStack Query に揃える。
- 元画像の先読みは初回表示または利用者の画像選択に続く有限の処理として許可する。feature の取得処理が表示対象を優先して直列化し、同一取得の引継ぎ、中断、容量、scope 終了時の query 破棄を所有する。自動 retry や回線復帰による取得再開を起こさず、確定・削除成功時は関連 cache の更新より先に画像の寿命を閉じる。先読みは画像切替の待ちを減らすためのもので、未取得の画像への切替まで待ちをなくすものではない。画像本体の取得は画面内で同時1件とし、Blob の保持量は [基本要求の画像の保存](requirements/base.md#53-画像の保存) の上限内に収める。
- query key は cache 内の runtime data shape まで区別する。同じ backend resource の raw response と ViewModel を両方 cache に置く場合は、別の key を使う。
- 対象の確定した不存在を再取得中も保持する read は、domain の `404 / NOT_FOUND` を read-result として扱い、raw response と異なる key に置く。一時的な通信失敗や一般的な HTTP 404 を不存在へ変換しない。mutation 後の cache 整合は両方の key を対象にし、以前の成功表示や候補一覧から不存在を巻き戻さない。
- master の管理と入力候補は同じ raw response を共有し、並べ替えを `select` へ閉じる。設定管理は現在の権限で許可された訪問済み tab に必要な query だけを有効にし、変更 response を cache へ反映してから表示名を含む関連 read を無効化する。確定した追加・訂正・削除は、再取得が失敗しても保つ。
- consumer の射影は `select` または純粋な表示変換で行い、cache は元の server data を保持する。表示中の data が現 query の値か前 scope の placeholder かは query observer の状態から判断し、その判定のために描画時に cache を別途読み直さない。
- fatal error、cached data を保った再取得、認証待ち、disabled query を別状態として扱い、mutation 後は表示中の resource と選択候補の cache をともに整合させる。
- Web の本人情報は auth query を正本とし、管理機能の表示・query・明示 refetch・送信直前の command を `shared/auth` の共通の許可判断へ接続する。再確認の進行と操作の所有期間も同じ境界で扱い、一時失敗中に旧 role だけで操作を再開しない。ロール変更の再確認中は、許可が残り得る作業の未保存入力と進行中の操作を保ちつつ、権限外の情報を表示・送信しない。確定失権した scope の入力は終了し、別主体・別対象へ持ち越さない。
- 確定失権した管理 read は cancel して cache を除去する。管理者権限だけの喪失ではアカウント・通知、運用権限も失った場合は分析管理・レーダーを対象にし、通常の master・分析結果等の共有参照は保持する。主体と許可の所有期間が変わった後の応答で保護 cache や新しい入力を復活・上書きせず、再付与を古い操作の継続と扱わない。同一主体が参照できる master の確定 mutation 結果の反映と、保護 refetch・画面の完了処理を分ける。
- 管理用 query / command の権限拒否は一度の本人情報再確認へ集約し、処理済み・旧作業の拒否を起点に循環させない。本人情報と保護 query の 401 / 403 は自動 retry せず、許可継続後も拒否された read の再試行は利用者の操作に任せる。再確認・再表示で POST を再送せず、確認中に到着した受付結果は既存 mutation の owner に保持する。
- 初回表示、mutation 後の cache 整合、artifact 失効時の bounded recovery、利用者が実行した更新 / 再試行が server state の取得を開始する。次項の受理済みレーダー作成・復元の完了確認を例外とし、それ以外では interval、遅延 timer、window focus、tab visibility、network reconnect を起点に自動再取得しない。この契約は共通 QueryClient に集約する。
- レーダー基準の作成・復元は、利用者が開始して受付が確定した操作に限り、待機表示から編集へ進むために完了状態を自動確認する。対象はその操作だけとし、完了・失敗・読取エラー・権限停止で止め、非表示ブラウザでは継続取得しない。読取失敗の再開は明示更新で行い、POST を再送しない。通常の管理状態取得や手入力の正式比較には適用しない。
- 分析の計算 payload が immutable でも、現在の名称や試合 revision に依存する HTTP projection は可変として扱う。master 変更は表示名を含む artifact response、試合訂正・削除はその試合の context と identity を更新する。手動更新は status で参照世代を確定してから必要な resource を読み、新旧 artifact を同時に再取得しない。
- match-context の確定した不存在・失効は成功済み cache の利用を止め、一時的な更新失敗と区別する。比較画面と試合結果画面で共通の利用判定を使い、表示 bundle の選択試合と全マーカーを揃える。再取得中の復活を含む状態契約は [分析 batch 要求の Web State](requirements/series-analysis-batch.md#web-state) を正本とする。
- React の concurrent / form API は cache、retry、認証、validation の既存契約を維持する範囲で使う。

## React Update Priority

- 入力値、選択 intent、focus は即時に反映する。`useDeferredValue` は追従を遅らせてもよい検証表示・一覧・図表に使い、送信時の validation と request は最新値から同期的に組み立てる。
- 入力や処理状況の購読は、それを表示する領域へ置く。独立した表示が一つの編集状態を共有するときは、必要に応じて画面寿命の store と用途別 snapshot を使い、変更のない view の参照を保つ。単独の入力・dialog は局所 state のままとし、Query の server data を別 store に複製しない。性能は必要な経路の観測で判断し、性能改善のための store・selector・memo は、観測で必要と分かった範囲に加える。
- 表示 bundle を遅延する場合は data、scope、view の identity を一緒に保つ。要求中の条件を古い図表の見出し・操作へ混ぜず、追従中の表示と操作制限は既存の stale 表示へ接続する。
- 作成結果を楽観表示する場合、成功 response を Query cache の確定値へ引き継いでから再取得する。確定は成功 response で行い、保存成功後に再取得が失敗しても作成成功を保つ。失敗した Action は入力を残し、成功時だけ明示的に初期化する。

| 対象 | 採用する更新境界 | 理由 |
| --- | --- | --- |
| 試合一覧・開催一覧の条件変更 | 即時の選択 intent、遅延した一覧、古い対象への操作制限 | 続けて条件を変えながら表示を追従させる |
| 戦績比較の view / scope / artifact | 整合した表示 bundle の遅延、図表の memo 境界 | 大きい図表更新を選択操作と分離する |
| 試合入力 | workspace が所有する数値文字列、遅延検証、cell 単位の draft 射影 | 表示幅・入力欄の開閉でも未完成の入力を維持し、無関係な cell の描画を抑える |
| マスタ作成 | Action と局所的な楽観行、成功 response の確定反映 | 待ち時間中も追加を示し、失敗時に入力を回復する |
| 保存・削除・OCR 開始・権限 / 通知変更・再計算・出力 | Action / mutation の pending と確定結果 | 検証、競合、副作用、生成結果を先取りしない |
| 開催選択・出力候補のページ取得 | Query の前ページ保持と scope 表示 | ページ単位の取得は既存の待機境界で扱える |

設定管理の訪問済み panel は、現在も許可される範囲で `keepMounted` により入力・DOM を保持する。管理権限の再確認では画面と dialog の表示・操作を一時停止し、非制御入力と進行中 command の owner を保つ。確定失権した panel・dialog・入力は終了し、許可が残る操作の入力や pending 保護まで一律に破棄しない。

## Client Lifecycle / Suspense / Motion

状態と表示補間の正本を次のように分離する。Motion は状態の視覚的な投影であり、application lifecycle の owner ではない。

| 関心事 | owner |
| --- | --- |
| server data、cache、refetch | TanStack Query |
| 楽観表示 | React `useOptimistic` または TanStack Query の mutation / cache のいずれか一方 |
| pending | Action、Transition、mutation など、その処理を開始した lifecycle |
| 操作と結果の通知単位・発火、inline feedback の継続条件 | 操作を所有する feature。表示先の選択は [UI 規約](ui-rule.md#取得状態フィードバックモーション) に従う |
| 通知の描画・読み上げ、toast の表示寿命 | shared UI。画面をまたぐ toast は app に置く共通 host |
| pathname、search params、navigation | React Router |
| dialog / disclosure / select の open、focus、keyboard | Base UI と owning shared UI primitive |
| DOM / SVG の補間、非対話的な exit snapshot | Motion |

- 同じ楽観表示は一つの owner が持ち、React `useOptimistic` と TanStack Query cache の二重管理を避ける。一つの表示箇所だけなら action / mutation の入力から局所 overlay を導出し、複数 consumer の server state を揃える必要がある場合だけ cache update と snapshot / rollback を使う。pending から server response へ同じ対象を引き継ぐ場合は、client で安定した identity を発行し、表示順や Motion の layout identity を data identity の代わりにしない。
- 表示準備、操作制限、通知は別の境界として設計する。表示準備は未準備な code / data と置換する body、操作制限は処理中の重複・競合操作、権限・前提条件、表示中と要求中の scope の違いから誤操作を招く範囲、通知は一つの利用者操作とその結果を成立させる取得のまとまりを扱う。query や親子 component ごとに同じ待機表示を生成せず、feature composition が既存の取得・操作状態から表示担当を導出する。通知の集約を理由に query を結合したり、独立した結果・失敗を一つの global pending に潰したりしない。
- Suspense は code / data readiness と fallback の presence を所有し、boundary は利用者に見せる loading sequence に合わせる。一度表示した dialog、tab list、toolbar、page surface の lifecycle を、その内部の body の待機から分離する。Suspense を使う場合は維持する部分を該当 boundary の外に置き、未準備な body だけを fallback と置き換える。最初の route module 自体が未準備な場合は route の structural fallback を使う。Motion や `AnimatePresence` で fallback と完成内容を crossfade せず、同じ primitive を loading 用と完成用に重複 mount して open / focus lifecycle を作り直さない。
- 異なる pathname は新しい route identity として、未準備なら route の structural fallback を表示する。同一 pathname の query key、filter、scope、sort、page の変更では、通常 query、Transition、deferred value など所有する state layer の手段で既存内容を維持し、Motion に待機や切替を決めさせない。
- 待機表示の整理だけを理由に通常 query と Suspense query の取得方式を置き換えず、boundary や content の identity を pending の切替で作り直さない。
- toast は feature が確定した実行結果から発火し、render、汎用 query observer、cache invalidation ごとの成功通知にしない。通常の route content の境界から共通 host を分離し、renderer は host と同期で準備する。最初の通知から同じ描画経路を使い、準備用表示との交換で見た目・focus・表示寿命を作り直さない。通知の一意性は実行結果に結び付け、server state や操作の完了判定を toast の状態に移さない。
- 有限で局所的な motion の標準実装は Motion for React とする。app の一つの provider で同期 `LazyMotion`、`domMin`、`strict`、`m` component を構成し、provider が `prefers-reduced-motion` を購読して `MotionConfig` と描画済みの末端 component へ反映する。gesture feature を含む bundle、layout / shared layout、drag / pan の導入は、必要性、操作契約、bundle 差分、主要 device の実測を伴う別の architecture decision とする。禁止する import は oxlint 設定が検査する。
- 面の hover は shared UI の surface feedback hook が native DOM の pointer 進入・離脱・cancel を観測し、Motion `animate` で内部の hover 量だけを補間する。CSS は意味に対応した色対と、pressed・focus・操作制限の即時表示を所有する。click、keyboard、選択、open をこの接続で再実装しない。Motion の hover gesture は押下中の leave を遅らせるため、この用途では使わず、`domMin` を維持する。有限 CSS transition の例外は設けない。外部 ref の接続・cleanup と動きを減らす設定の変更も接続側が扱い、画面へ時間・色・hover 状態を公開しない。
- Motion の宣言は、変化する pixel と semantic state を所有する shared UI primitive または feature の末端 visual component に置く。画面の合成 hook、resource / command / query hook、router は Motion を import しない。`Fade`、`Slide`、`Scale` のように effect 名だけを隠す pass-through wrapper は作らず、複数用途の accessibility、state mapping、interruption を一つの小さい契約で隠せる場合だけ shared abstraction にする。
- application code は Motion の完了 callback を、data、cache、route、open、focus、pending、error、操作可能性を進める唯一の条件にしない。callback が所有してよいのは、中断または未実行でも application state を誤らせない冪等な表示上の後始末に限る。exit のため一時保持する node は非対話的かつ accessibility tree の対象外とし、先に確定した state と focus を巻き戻さない。
- presence による一時保持は、shared dialog と toast が通常の close / remove 後に非対話的な exit snapshot を描く場合だけ許可する。親 subtree、route、artifact、view の identity が失われた場合は exit を省略してよく、表示補間のためにそれらの lifecycle を遅らせない。
- 処理時間が不定な Spinner / Skeleton の loop だけは shared loading primitive 内の CSS を使ってよい。それ以外の新しい有限 motion は Motion に統一し、同じ transition に CSS、timer、Web Animations API、別の motion engine を混ぜない。Motion 導入時は既存の有限 CSS transition もこの境界へ移し、CSS loop の feature 直書きを shared loading primitive へ集約する。
- reduced motion では非必須の残存 motion を末端 component でも省略する。Motion の初回導入と feature bundle の変更では production build の bundle 差分を測る。

## Form / React 19 / API Client

- request transform は route / prefill / hidden identifier を request まで保つ。
- 入力の owner は認証主体と作業対象で区切る。同じ作業の補助 query 変更では保持し、別の試合・draft・sample へ持ち越さない。未完成の数値文字列も入力に含め、validation と request は同じ最新値の射影を使う。一時保存の schema は、完成済み request の制約と分離して入力途中の値を保持する。設定への移動前は既存の保存処理の成功を確認し、ブラウザーの戻るでも同じ主体・作業・元データに限って復元する。role を作業や保存の identity に加えない。
- 編集可能になった最初の snapshot で入力を初期化し、同じ作業の再取得の後も入力を保つ。OCR の入力値・根拠・元画像 descriptor は同じ世代に固定し、世代変更時には再確認を案内する。保存中は送信対象の編集と離脱を保護し、完了前に遮断した離脱操作を完了後に自動再開しない。
- navigation、feedback、browser download など画面に属する非同期の完了処理は、開始時の route / 対象 / 最新 intent に対応する場合だけ行う。所有者の commit 境界で古い処理を無効にし、中断可能な read は中断する。確定 mutation の cache 整合は画面に属する副作用と分ける。
- 分析の集計、意味を持つ sort / filter、閾値、統計 fallback の計算は Worker の成果物が担い、Web は保存済み成果物を表示用に整形する。公開値の正本を Worker の成果物に保ち、Web の仮計算を正式値と混同させないためである。例外は [レーダー閾値編集の仮プレビュー](requirements/series-player-radar.md#閾値の手入力と自動プレビュー) と [総合成績の見通しの試算](requirements/series-rank-outlook.md#12-採用する計算方法) に限る。
- OCR の開始確認では設定・画像と送信する作品ヒントを同じ snapshot に固定する。API がジョブ受付時に既定のプレーヤー別名と登録済み別名を snapshot 化し、payload 上限を検証する。作品方式ごとの CPU 名の既定値と認識時の名前照合は Worker が所有し、明示した CPU 名を優先する。Web はそのための別名取得・正規化・上限処理を持たない。既存 OCR 結果から編集フォームを復元する名前解決は、入力支援として Web に残す。
- OCR 送信の再試行は日時、下書き ID、upload 済み画像 ID、idempotency key を同じ intent 内で保持する。応答消失を未受付と推測して下書きを取消したり、新しい画像・下書きを作り直したりしない。送信前の不備と確定した受付拒否は入力修正へ戻せるようにし、受理不明の再送と区別する。

## API / UI Boundary

- Web の API 型は `shared/api` の用途別 facade を介す。credential、CSRF、Problem Details、idempotency は共通 client で扱う。同一 mutation の retry は同じ操作 key を再利用し、payload が変われば新しい key にする。
- UI の意味表現と操作契約は [UI 規約](ui-rule.md) を正本とする。shared UI と semantic token から外れる実装は、利用者に現れる意味・状態・操作への影響で review し、source 表記だけを一律の適合判定にしない。

## Build / Test Tooling

- API 生成は Tapir 由来 OpenAPI から型、resource 別の遅延読込 registry、CSP 下で実行できる事前コンパイル済み validator をまとめて導出する。途中の schema は生成処理内に閉じ、追跡するのは consumer のある生成物だけとする。
- build checker の成功は最終 CSS に必要な識別子が残る証拠であり、CSS cascade や実際の paint の証拠とは区別する（[テスト・品質規約の UI Conformance](test-rule.md#ui-conformance)）。
- script の配置と E2E 入口の所有は [アーキテクチャの Scripts / Tooling Boundaries](architecture.md#scripts--tooling-boundaries) に従う。
