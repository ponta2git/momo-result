# テスト・品質規約

この文書はテスト層、必須検証、品質ゲートの正本である。コマンドは `docs/dev-rule.md`、DB所有権は `docs/db-rule.md` を参照する。

## 1. 判断原則

- 変更した実行経路を直接通す。近いテストの成功で代用しない。
- テスト層の責務を混同しない。
- 外部サービス依存の検証が skip / 未実行なら、その挙動は未検証として報告する。
- 障害対応では、報告された操作・query・endpoint そのものを回帰テストに含める。
- `docs/post-mortem/lessons.md` に該当する教訓があれば、テスト選択に反映する。

## 2. テスト層

| 層 | 捕まえるもの | 代表 |
|---|---|---|
| DB contract | APIが前提にする table / column / seed / nullable / default | `DbContractSpec` |
| PostgreSQL repository | SQL syntax、filter/order、transaction、PostgreSQL固有挙動 | `Postgres*Spec` |
| Redis integration | Redis Streams wire 動作、ack/claim/retry | `apiRedisQuality` |
| HTTP/API | request parsing、auth/CSRF、response encoding、AppError mapping | `*HttpSpec` |
| Usecase/unit | domain 分岐、validation、状態遷移 | `*Spec` |
| web component/page | UI状態、入力操作、APIエラー表示、query cache lifecycle | Vitest + Testing Library |
| OCR unit/integration | 画像種別判定、解析器、DB/Redis連携、失敗処理 | pytest |
| E2E smoke | ログイン後の主要結合フロー | Playwright |

## 3. Webテスト

### Query / API error

TanStack Query を使うページで API エラー表示、`queryKey`、`queryFn`、データ整形を変更する場合:

- `query.error` / `isError` だけをページ失敗表示の根拠にしない。
- 認証、`enabled`、`isFetching` / `fetchStatus` と表示条件の整合をテストする。
- cached error -> remount -> refetch success など、変更対象の lifecycle を直接通す。
- 同じ backend resource を複数画面で読む場合は、別画面が seed した cache shape を再現するか、実際の画面遷移順を通す。
- mutation で作成した resource を同画面の select/list で即時選択・表示する場合は、成功通知だけでなく、選択値と候補 option/list への追加を両方検証する。

### Form / interaction

form、filter、select、input、button の handler を変更する場合:

- Testing Library + user-event で変更した操作を実行する。
- レンダリング確認だけで `onChange` / `onSubmit` / `onClick` の検証にしない。
- React event の値は handler 内で退避し、state updater 内で event / DOM node を読まない。
- 障害対応では報告された操作そのものを通し、同一 component 内の同種 handler pattern を検索する。
- PC用とモバイル用でUIが二重なら、検証した経路を明示する。

### React performance / UX

React 19 API、route preload、hot path の入力処理、Suspense 境界、`useDeferredValue` / `useTransition` / `<Activity>` を変更する場合:

- `pnpm --filter web lint`、`typecheck`、対象 component/page の user-event テストを通す。
- 入力中 state を局所化した場合は、入力途中、blur、Enter/Tab 移動、送信直前の値確定を検証する。
- React Compiler は採用しない限り前提にしない。補助診断として `pnpm --filter web lint:react-perf` を使った場合は、production code 向けの hard gate ではない診断であることを最終報告に明記する。テストを含む全体監査は `pnpm --filter web lint:react-perf:all` で分けて扱う。
- route preload は feature から app layer へ逆依存させず、router 側の loader 関数と app shell 側のイベントで検証する。

### Form schema / request transform

Zod schema、フォーム値から API request への変換、mutation payload を変更する場合:

- route param、prefill、hidden state 由来の workflow identifier が mutation に必要なら、schema
  parse / transform 後の request body に残ることをテストする。
- create / confirm / update で受け付ける field が違う場合は、共有変換で暗黙に流用せず、送る field
  と落とす field をテストで固定する。
- optional field の有無で endpoint / usecase の意味論や副作用が変わる場合は、その field を
  mode discriminator として扱い、各 mode の request payload をテストする。
- 画面の prefill テストだけで payload 契約の検証にしない。`form values -> request DTO` の境界を直接通す。

### Test foundation

- 共通 setup は `apps/web/src/test/setup.ts` に集約する。
- Vitest は file-level parallelism と file isolation を有効にする。テスト間共有を前提にせず、共有 store / handler / storage / mock は各 test file の lifecycle で初期化・破棄する。
- test-scoped QueryClient は `apps/web/src/test/queryClient.ts` の `createTestQueryClient` を使う。
- `createTestQueryClient` は本番で問題になる remount / stale cache lifecycle を隠さない。retry や window focus など非決定的な要素だけを抑え、`refetchOnMount` を無効化したい場合はテスト内で理由が分かる局所設定にする。
- OpenAPI由来の fixture は `apps/web/src/test/factories/` に置く。
- DOM API / prototype 差し替えは `apps/web/src/test/doubles/` の typed helper を優先する。
- ダウンロード用 anchor click など jsdom が実ブラウザ副作用を実行しようとする箇所は typed helper で止め、成功 oracle は fileName / href などユーザー価値に近い属性で置く。
- `vi.stubGlobal` は共通 setup で解除される。個別テストでは stub を跨いだ期待にせず、必要なら対象テスト内で stub を作り直す。
- MSW は API / page / component integration テストだけで `apps/web/src/test/msw/lifecycle.ts` の `setupMsw()` を呼んで有効化する。純粋ロジックや直接 `fetch` を stub するテストへ暗黙適用しない。
- MSW の module-scope store を増やしたら `resetMswStores` に登録する。
- Toast manager など重い UI singleton state は共通 setup へ入れず、ToastHost などを直接検証するテストで局所的に後片付けする。
- 出現待ちは `findBy*` を優先する。`waitFor` は disappearance、複数 expect、non-DOM assertion に限る。
- Testing Library のユーザー操作は `userEvent.setup()` で test-scoped user を作って実行する。`userEvent.click(...)` などの静的呼び出しや `fireEvent` は、ユーザー操作では表現できない低レベル event を明示的に検証する場合に限る。
- in-flight 状態は実時間 `setTimeout` に依存せず、`apps/web/src/test/deferred.ts` の deferred promise とリクエスト到達イベントで制御する。
- 純粋ロジックの `*.test.ts` は `// @vitest-environment node` を付ける。browser API / storage / DOM / direct fetch API 境界を扱う `*.test.ts` は `// @vitest-environment jsdom` を付け、必要な環境を暗黙の global default にしない。
- assertion は role/name/value/state まで固定する。`length > 0` や単なる「存在する」だけで終えない。
- `console.error` / `console.warn` は共通 setup で失敗扱いにする。React の `act` warning、duplicate key、未実装ブラウザ副作用は成功テスト内のノイズではなく、独立性・フレーク耐性の欠陥として原因を解消する。

### Web coverage / oracle

- `apps/web` の C1 は `pnpm --filter web test:coverage` で管理する。対象は `src/app/**/*.ts`、`src/features/**/*.ts`、`src/shared/**/*.ts` の下位ロジック/API境界で、生成コード、テスト支援、`.d.ts` は対象外にする。
- coverage 閾値は `apps/web/vite.config.ts` の Vitest 設定を正とする。分岐条件、API request/response 変換、query cache invalidation、view model、reducer、workflow の変更では `test:coverage` を通す。
- aggregate 閾値だけでは重要な低カバレッジ file を相殺できるため、keyboard policy、cache key、query error state など事故時の blast radius が大きい下位モジュールは file/glob 単位の閾値を追加する。
- C2 は V8 coverage だけでは測れないため、複合条件を持つ下位ロジックでは decision table で管理する。`&&`、`||`、三項演算子、mode discriminator、`enabled`、`isFetching`、`isError`、cached data 有無を組み合わせる条件は、独立因子と期待値が分かる table-driven test にする。
- オラクルは「内部実装の式」ではなく、ユーザー可視状態、request DTO、cache key、cache invalidation、状態遷移、例外/エラー表示の契約で固定する。helper の return 値だけをなぞるテストにしない。
- 型耐性が重要な table / fixture は `satisfies` と OpenAPI 由来型を使い、列挙値や payload shape の変更でテストコードも型エラーになるようにする。

## 4. DB-backed API

PostgreSQL repository、Doobie query、DB table/column、migration 前提に触れたら `apiDbQuality` 対象として扱う。

必須:

- endpoint / usecase / repository / method を特定する。
- 新しい table / column / seed / nullable / default 前提は `DbContractSpec` に追加する。
- 変更した repository method を Testcontainers Postgres で実行する spec を追加・更新する。
- 新しい table に書き込む integration test を追加したら cleanup 対象も更新する。

実DB実行が特に必須のSQL:

- `UNION` / `INTERSECT` / `EXCEPT`
- `DISTINCT`
- window function
- JSON operator
- dynamic fragment
- 複数 table をまたぐ filter / order / limit

`sbt test` は integration を除外する。DB動作を検証したと報告するには `sbt apiDbQuality` の成功が必要。

## 5. 外部サービス依存

- Docker / Redis / PostgreSQL / 外部プロセス依存のテストは下位単体テストと混ぜない。
- PostgreSQL-backed spec は `Integration` と `DbIntegration` tag を付け、`apiDbQuality` で実行する。
- Redis Streams wire 動作は `Integration` と `RedisIntegration` tag を付け、`apiRedisQuality` で実行する。
- API の統合テスト tag は `apps/api/src/test/scala/momo/api/testing/TestTags.scala` を正本とし、spec 内で
  `new munit.Tag(...)` を直接定義しない。
- PostgreSQL-backed spec は `IntegrationSuite` を継承し、DB cleanup と tag 付与を suite 側に集約する。
- Redis-backed spec は `momo.api.integration.redis` 配下に置き、`RedisIntegrationSuite` を継承して tag 付与を
  suite 側に集約する。
- `apiDbQuality` / `apiRedisQuality` は spec 名の手動列挙ではなく、package/class pattern と capability tag で
  対象を発見する。PostgreSQL-backed spec は `Postgres*Spec` として命名し、`DbContractSpec` と同じ DB gate に乗せる。
- OCR worker の Postgres integration も手書きDDLではなく `momo-db` migration を使う。
- stateful な外部サービスを使う spec は、stream名、DB row、一時ファイル名をテストごとに分離する。
- sleep ではなく、publish後の読み取り、deferred promise、明示的な状態確認で同期する。

## 6. 品質ゲート

| 領域 | 標準ゲート |
|---|---|
| web | `pnpm --filter web generate:api`, `format:check`, `lint`, `typecheck`, `test:run`, `test:coverage`, `build` |
| api | `sbt apiQuality`, `sbt test`, 必要に応じて `apiDbQuality` / `apiRedisQuality` |
| ocr-worker | `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy`, `uv run pytest` |

CI では対象領域ごとに format、lint、typecheck/compile、test、必要な integration、build/OpenAPI check を実行する。ローカルでは変更範囲に応じて同等のゲートを選ぶ。
