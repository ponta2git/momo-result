# Postmortem Lessons

このファイルは、過去の障害・検証漏れを実装時に思い出すための入口である。恒久的な規約にできる内容は、対応する `docs/*-rule.md` に移設する。

## 前提

- 教訓は機械的に全部適用しない。実装・検証前に「今回の変更にこの教訓が有用か」を短く反芻してから使う。
- 有用だと判断した教訓は、作業計画・テスト選択・最終報告のいずれかに反映する。
- 該当しない教訓は無理に適用しない。ただし、該当しない理由を自分で説明できる状態にする。
- 恒久化できる教訓は、このファイルに溜め込まず、`docs/db-rule.md`、`docs/test-rule.md`、`docs/dev-rule.md` などの実行規約へ移す。
- クオリティゲート直前には、このファイルを再確認し、見落とした教訓がないか確認する。

## 使い方

1. 変更対象を確認する。
2. 下の「反芻ポイント」から該当するものだけを選ぶ。
3. 該当したものについて、移設先の規約を読む。
4. 検証できなかった場合は、最終報告で「未検証」と明記する。

## 反芻ポイント

### PostgreSQL / DB-backed API

該当条件:

- `apps/api` の PostgreSQL repository を変更する。
- SQL fragment、Doobie query、DB table/column、migration 前提に触れる。
- APIエラーが `relation does not exist`、SQLSTATE、PostgreSQL syntax/runtime error を含む。

思い出すこと:

- Scala/DoobieでコンパイルできたSQLは、PostgreSQLで正しいSQLとは限らない。
- 関連Repositoryのテスト成功は、該当EndpointのDB経路を検証したことにならない。
- `momo-db` にmigrationがあることと、接続先DBに適用済みであることは別である。
- integration test がDB未起動でskipされた場合、DB動作は未検証である。

参照:

- DB契約とcross-repo migration: `docs/db-rule.md`
- DB-backed APIのテスト責務: `docs/test-rule.md`
- ローカルDB起動と検証コマンド: `docs/dev-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-backend-matches-list-db-errors.md`

### テストアーキテクチャ

該当条件:

- テスト追加・修正を伴う。
- 「どのテストを走らせれば十分か」を判断する。
- ある層のテストで別の層の不具合を代用検証しようとしている。

思い出すこと:

- テストは層ごとに責務を分ける。
- DB contract、Repository SQL、HTTP境界、Usecase分岐は別の失敗を捕まえる。
- 事故を起こした実行単位を通さないテストは、再発防止として不十分である。

参照:

- テストレイヤの責務: `docs/test-rule.md`
- DB-backed API変更時の検証: `docs/dev-rule.md`

### Frontend / テストオラクルとテストダブル

該当条件:

- フロントの `*.test.ts(x)` を追加・修正している。
- ページ統合テストを書いている。
- `vi.spyOn` / 直代入 / MSW handlers / DOM API 差し替えを使う。

思い出すこと:

- 弱オラクル禁止: `length > 0` / 単独の `toBeInTheDocument()` / "without crashing" / "存在する"系の test name は使わない。代わりに役割と name を指定した role-based query (`getByRole`/`findByRole`) で同定し、可能なら属性 (`href` 等) や値・state まで固定する。
- モジュールスコープの可変ストア (MSW handlers の seed 配列など) は `server.resetHandlers()` で復元されない。`afterEach` で個別に `resetMswStores()` を呼ぶ。新規 store を追加したら必ずリセットに加える。
- `HTMLVideoElement.prototype.play` 等のプロトタイプ直代入は `afterEach` で必ず元の値に戻す。`vi.spyOn` を使い、`vi.restoreAllMocks()` か `restoreMocks: true` で集中的にリセットする。
- `as unknown as` で型契約を回避するくらいなら、`src/test/doubles/` に typed helper を用意する。テスト側で型エラーが出るのは仕様変更検知のシグナルである。
- 共通テストデータは `src/test/factories/` に集約する。各テストファイルで inline payload を 30+ 行 量産しない。OpenAPI 由来型 (`components["schemas"]["..."]`) を直接参照する。
- 共有 `queryClient` instance を全テストで使うと並行・retry・cache の混入リスクがある。test-scoped factory (`createTestQueryClient` で `retry: false`, `gcTime: 0`) を使う。

参照:

- フロント実装規約: `docs/architecture.md`
- フロントテスト方針: `docs/test-rule.md`
- 共有 factory: `apps/web/src/test/factories/`
- MSW reset: `apps/web/src/shared/api/msw/handlers.ts` の `resetMswStores`

### Frontend / TanStack Query error visibility

該当条件:

- `apps/web` のTanStack Queryを使うページでAPIエラー表示を追加・変更する。
- `query.error`、`isError`、`isFetching`、`enabled`、認証状態を使ってUI表示を分岐する。
- 一時的なAPI失敗後のremount、refetch、復旧表示に触れる。

思い出すこと:

- `query.error` があることは、現在の読み込みが致命的に失敗していることと同義ではない。
- 認証後に有効化されるqueryは、エラー表示側も認証・`enabled` 前提と合わせる。
- APIエラー表示の回帰テストは、必要に応じて cached error -> remount -> refetch success のような
  query lifecycleを直接通す。

参照:

- TanStack Queryエラー表示の実装規約: `docs/architecture.md`
- web component/pageのテスト責務: `docs/test-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-frontend-masters-query-error-visibility.md`

### Frontend / TanStack Query cache shape

該当条件:

- `apps/web` でTanStack Queryの `queryKey`、`queryFn`、API wrapper、query dataの整形処理を追加・変更する。
- 同じbackend resourceを複数画面・複数featureから読む。
- ある画面では `{ items: [...] }` のような生APIレスポンス、別画面では配列やViewModelなど整形済みデータを使う。

思い出すこと:

- Query KeyはAPIリソース名ではなく、runtime cache valueの同一性を表す。
- 同じkeyに異なるshapeを保存すると、TypeScript上は正しく見えても別画面遷移後にruntime crashし得る。
- 共有resourceのquery変更では、別画面が先にcacheへ入れたshapeをseedするテストを検討する。

参照:

- TanStack Query cache shapeの実装規約: `docs/architecture.md`
- web component/pageのquery cacheテスト責務: `docs/test-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-frontend-masters-query-key-shape-collision.md`

### Frontend / form interaction execution path

該当条件:

- `apps/web` の form、filter、select、input、button のイベントハンドラを追加・変更する。
- `setState((current) => ...)` の updater 内で event や DOM node を参照している。
- レンダリングテストはあるが、変更した入力操作を user-event で実行していない。

思い出すこと:

- React event 由来の値は handler 内で同期的に退避し、state updater 内では退避済みの値だけを使う。
- UIが表示されることと、ユーザー操作の実行経路が壊れていないことは別である。
- 代表的な form/filter 操作は Testing Library + user-event で直接通す。
- 障害対応では、類似する代表操作ではなく報告された操作そのものを通し、同一 component 内の同種 handler pattern も確認する。

参照:

- web component/page の入力操作テスト責務: `docs/test-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-frontend-matches-filter-event-currenttarget.md`
- 再発事象: `docs/post-mortem/2026-05-04-frontend-matches-sort-event-currenttarget-regression.md`

### Cross-repo schema dependency

該当条件:

- `docs/db-rule.md` にある共有DBまたは `../momo-db` のschema/migrationに依存する。
- API側の変更が、DB migration適用順序に依存する。

思い出すこと:

- migrationが別repoにあることは、consumer側が検証しなくてよい理由にならない。
- deploy前提・ローカル前提・テスト前提を分けて扱う。

参照:

- momo-db / summitアプリ・共有DBとの関係: `docs/db-rule.md`
- ローカルDB・Redis起動: `docs/dev-rule.md`

## React 19.2 / TanStack Query 5: `use(promise)` と Suspense

教訓:

- `use(promise)` は render 時にプロミスをアンラップする API で、Suspense と組む。一見魅力的だが、データ取得経路が既に TanStack Query で集約されている場合は採用すべきでない。
  - キャッシュ・dedup・retry・401/403 正規化を失う。
  - 同じデータを参照する別コンポーネントが各自プロミスを生成してしまう。
- 単発プロミス（poll callback 内の `getOcrDraft(...)`、sessionStorage 復元など）は render 時に存在しないため `use()` 不適合。
- `<form action>` + `useActionState` では、optimistic 更新は action 内で `addOptimistic*` を同期的に呼んでから `await` すること。await 後に呼ぶと transition が解決済みで反映されない。
- `useFormStatus` は同じ `<form>` の子コンポーネント内でのみ pending を読める。submit ボタンと cancel ボタンを同居させる場合、cancel は `type="button"` を明示する。
- `<Context>` 直接利用 / Provider 撤去は createContext を自前で持つ場合のみ意味がある。外部ライブラリの Provider（QueryClientProvider 等）には適用できない。
- `<Activity mode="hidden">` は「不要になった UI を捨てずに残し、状態とリソースを保持する」ための仕掛け。採用は次の条件を全て満たすときに限る:
  - 隠す/見せるの切替を頻繁に行う UI で、再マウントするとユーザー入力やスクロール状態が失われる。
  - 隠した状態でも DOM/データ取得を保持しておく実利がある（再表示時に明確な高速化や状態復元が必要）。
  - メモリ常駐コストが見合う（タブ数が小さい、画像が軽量等）。
  - momo-result 現状の評価: SourceImagePanel は同時に 1 種別のみ表示（画像 3 枚は HTTP/disk cache で再表示が安価）、ScoreGrid の desktop/mobile 切替はビューポート変化のみ、Workspace に複数タブ UI は無し。いずれも `<Activity>` を導入する正味のメリットが薄いため採用見送り。

思い出すこと:

- 「最新 API があるから使う」ではなく、副次的複雑さを減らす目的に対し正味で得かを評価する。
- 採否の根拠を残す（特に「採用しない」結論）。

参照:

- 全面ブラッシュアップ計画: `~/.copilot/session-state/<id>/plan.md`

## 最終報告に含めること

該当する教訓があった場合、最終報告では次を短く述べる。

- どの教訓が該当したか。
- どの規約文書に従ったか。
- どのテスト・コマンドで検証したか。
- DB/integration test がskipされた場合、何が未検証か。
- 追加すべきテストや品質ゲートが残る場合、その残リスク。
