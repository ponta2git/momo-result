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

### Form / interaction

form、filter、select、input、button の handler を変更する場合:

- Testing Library + user-event で変更した操作を実行する。
- レンダリング確認だけで `onChange` / `onSubmit` / `onClick` の検証にしない。
- React event の値は handler 内で退避し、state updater 内で event / DOM node を読まない。
- 障害対応では報告された操作そのものを通し、同一 component 内の同種 handler pattern を検索する。
- PC用とモバイル用でUIが二重なら、検証した経路を明示する。

### Test foundation

- 共通 setup は `apps/web/src/test/setup.ts` に集約する。
- test-scoped QueryClient は `apps/web/src/test/queryClient.ts` の `createTestQueryClient` を使う。
- OpenAPI由来の fixture は `apps/web/src/test/factories/` に置く。
- DOM API / prototype 差し替えは `apps/web/src/test/doubles/` の typed helper を優先する。
- MSW の module-scope store を増やしたら `resetMswStores` に登録する。
- 出現待ちは `findBy*` を優先する。`waitFor` は disappearance、複数 expect、non-DOM assertion に限る。
- in-flight 状態は実時間 `setTimeout` に依存せず、deferred promise とリクエスト到達イベントで制御する。
- 純粋ロジックの `*.test.ts` は必要に応じて `// @vitest-environment node` を付ける。
- assertion は role/name/value/state まで固定する。`length > 0` や単なる「存在する」だけで終えない。

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
- PostgreSQL-backed spec は `Integration` tag を付け、`apiDbQuality` で実行する。
- Redis Streams wire 動作は `Integration` tag を付け、`apiRedisQuality` で実行する。
- OCR worker の Postgres integration も手書きDDLではなく `momo-db` migration を使う。
- stateful な外部サービスを使う spec は、stream名、DB row、一時ファイル名をテストごとに分離する。
- sleep ではなく、publish後の読み取り、deferred promise、明示的な状態確認で同期する。

## 6. 品質ゲート

| 領域 | 標準ゲート |
|---|---|
| web | `pnpm --filter web generate:api`, `format:check`, `lint`, `typecheck`, `test:run`, `build` |
| api | `sbt apiQuality`, `sbt test`, 必要に応じて `apiDbQuality` / `apiRedisQuality` |
| ocr-worker | `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy`, `uv run pytest` |

CI では対象領域ごとに format、lint、typecheck/compile、test、必要な integration、build/OpenAPI check を実行する。ローカルでは変更範囲に応じて同等のゲートを選ぶ。
