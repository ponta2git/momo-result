# テスト・品質規約

目的: テスト層、必須検証、品質ゲートの正本。

読む条件:

- テストを追加・修正する。
- 変更範囲に対して必要な gate を選ぶ。
- 障害対応で再発防止テストを決める。

参照:

- コマンド: `docs/dev-rule.md`
- DB所有権: `docs/db-rule.md`
- 最終チェック: `docs/post-mortem/lessons.md`

## 1. Principles

- 変更した実行経路を直接通す。近いテストの成功で代用しない。
- テスト層の責務を混同しない。
- 障害対応では、報告された操作・query・endpoint そのものを回帰テストに含める。
- 外部サービス依存の検証が skip / 未実行なら、その挙動は未検証として報告する。
- assertion はユーザー可視状態、request / response DTO、DB row、queue payload、state transition、Problem Details などの外部契約に置く。
- `exists`、`length > 0`、成功/失敗 boolean だけで終えない。
- 非同期は sleep / wall clock で同期しない。deferred promise、test clock、状態観測、wire integration gate を使う。
- 共有 mutable state、固定 writable path、module-scope store は test ごとに分離・cleanup する。

## 2. Test Layers

| 層 | 捕まえるもの | Gate |
|---|---|---|
| domain / usecase unit | 分岐、validation、状態遷移 | `sbt test`, `uv run pytest`, Vitest |
| HTTP/API | request parsing、auth/CSRF、response encoding、error mapping | `sbt test` |
| web component/page | UI状態、入力操作、APIエラー表示、query cache lifecycle | `pnpm test:run` |
| PostgreSQL repository | SQL syntax、transaction、PostgreSQL固有挙動 | `sbt apiDbQuality` |
| DB contract | table / column / seed / nullable / default | `sbt apiDbQuality` |
| Redis integration | Redis Streams wire 動作、ack/claim/retry | `sbt apiRedisQuality`, worker integration |
| OCR worker | 画面種別判定、解析、payload validation、失敗処理 | `uv run pytest` |
| E2E smoke | ログイン後の主要結合フロー | Playwright |

通常の `sbt test` と `uv run pytest` は外部 integration を除外する。DB/Redis/native OCR などの wire 動作を検証したと言うには、対応する integration gate の成功が必要。

## 3. Web Rules

### Query / API Error

TanStack Query の `queryKey`、`queryFn`、API wrapper、ViewModel変換、error表示、mutation後cache反映を変更した場合:

- `query.error` / `isError` だけをページ失敗表示の根拠にしない。
- 認証、`enabled`、`isFetching` / `fetchStatus`、cached error、refetch success の lifecycle を通す。
- 同じ backend resource を複数画面で読む場合は、cache shape と invalidation 範囲を検証する。
- mutation で作成した resource を同画面で選ぶ場合は、選択値と候補 list/select の両方を検証する。

### Form / Interaction

form、filter、select、input、button、Zod schema、request transform、mutation payload を変更した場合:

- Testing Library + `userEvent.setup()` で変更した操作を直接実行する。
- React event の値は handler 内で退避し、state updater 内で event / DOM node を読まない。
- route param、prefill、hidden state 由来の workflow identifier が request body に残ることを検証する。
- optional field が mode discriminator なら、各 mode の payload と副作用を検証する。
- PC用とモバイル用でUIが二重なら、検証した経路を明示する。

### Test Foundation

- 共通 setup、QueryClient、MSW lifecycle、factory、DOM double は既存の `apps/web/src/test/` 配下の helper を使う。
- MSW の module-scope store を増やしたら reset 対象へ登録する。
- 出現待ちは `findBy*` を優先する。`waitFor` は disappearance、複数 assertion、non-DOM assertion に限る。
- pure logic は `node`、DOM / browser API / direct fetch 境界は `jsdom` のように、必要な test environment を明示する。
- `console.error` / `console.warn` は失敗扱い。React `act` warning、duplicate key、未実装ブラウザ副作用を放置しない。

## 4. API Rules

- usecase / domain / HTTP 境界テストは、実DTO、実 codec、in-memory repository、実状態遷移を優先する。
- interaction verification は外部副作用、失敗注入、ログ観測、時刻、乱数、ネットワーク境界に限定する。
- stateful test double は test ごとの `IO` / `Resource` / fixture で生成する。module-scope の `Ref` や可変状態を共有しない。
- 値 fixture は意味のある factory / builder に寄せる。境界変換そのものを検証する場合を除き、raw map や文字列連結を主オラクルにしない。
- HTTP app 起動は request parsing、auth/CSRF、response mapping が oracle のときに絞る。

### DB-backed API

PostgreSQL repository、Doobie query、DB table/column、migration 前提に触れたら:

- endpoint / usecase / repository / method を特定する。
- 新しい table / column / seed / nullable / default 前提は `DbContractSpec` に追加する。
- 変更した repository method を Testcontainers PostgreSQL で実行する。
- 同一 transaction で FK 関連 row を作成・更新する method は、成功 path と保存後の linked row values を検証する。
- 新しい table に書き込む integration test を追加したら cleanup 対象も更新する。

実DB実行が特に必要なSQL:

- `UNION` / `INTERSECT` / `EXCEPT`
- `DISTINCT`
- window function
- JSON operator
- dynamic fragment
- 複数 table をまたぐ filter / order / limit

## 5. OCR Worker Rules

- runner / parser / domain / payload validation は、実 dataclass、実 parser、in-memory repository / consumer、実状態遷移を優先する。
- interaction verification は Redis wire adapter、subprocess / native OCR API、process composition、worker loop の停止・retry 境界に限定する。
- Docker、Redis、PostgreSQL、native OCR engine、tessdata は integration marker へ分離する。
- screen type 判定、queue payload validation、failure code mapping、ack / pending / DLQ、parser profile selection、OCR postprocess の複合条件は table-driven test にする。
- oracle は OCR draft payload、warning / failure code、queue ack / DLQ field、DB row、画像メタデータなど外部契約に置く。
- fixture は domain 上の意味が分かる名前にし、大量の inline dict / temporary image を増やさない。

## 6. Coverage / C2

- coverage 閾値は各設定ファイルを正とする。
  - web: `apps/web/vite.config.ts`
  - api: `apps/api/build.sbt`
  - ocr-worker: `apps/ocr-worker/pyproject.toml`
- aggregate coverage だけで重要経路を保証しない。blast radius が大きい下位モジュールは file / glob 単位または明示的な table test で固定する。
- C2 は coverage tool の branch coverage だけでは保証しない。`&&`、`||`、三項演算子、mode discriminator、`enabled`、`isFetching`、`isError`、cached data 有無などは decision table で独立因子と期待値を示す。
- 型耐性が重要な fixture は生成型、domain型、`satisfies` などで shape 変更を型エラーにする。

## 7. External Services

- PostgreSQL-backed spec は `Integration` と `DbIntegration` tag を付け、`apiDbQuality` で実行する。
- Redis-backed spec は `Integration` と `RedisIntegration` tag を付け、`apiRedisQuality` で実行する。
- API integration tag は `apps/api/src/test/scala/momo/api/testing/TestTags.scala` を正本とし、spec 内で直接 `new munit.Tag(...)` しない。
- PostgreSQL-backed spec は `IntegrationSuite`、Redis-backed spec は `RedisIntegrationSuite` へ寄せる。
- OCR worker integration は pytest の `integration` marker を付ける。複数 adapter smoke は必要最小限にし、状態遷移・payload validation・parser分岐は unit/contract test に寄せる。
- 外部サービスを使う spec は、stream名、DB row、一時ファイル名、worker id を test / suite ごとに分離する。

## 8. Quality Gates

標準 gate は `docs/dev-rule.md` の Change Gates を正とする。

追加判断:

- API / web DTO 契約を変えたら OpenAPI生成物と web generated type を更新する。
- API coverage 対象ロジックを変更したら `docs/dev-rule.md` の `sbt apiCoverage` を実行する。
- Redis Streams / OCR queue 契約を変えたら `docs/redis-streams-ocr-contract.md` の Required Tests を実行する。
- DB schema 前提を変えたら `docs/db-rule.md` の Consumer Contract を満たす。
- `docs/post-mortem/lessons.md` に該当するカードがあれば、テスト選択と最終報告に反映する。
