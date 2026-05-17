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

## 4. API coverage / oracle

- `apps/api` の C1 は `cd apps/api && sbt apiCoverage` で管理する。対象は手書きの domain / usecase / HTTP 境界 / in-memory repository adapter / codec / queue payload で、entrypoint、OpenAPI generator、PostgreSQL / Redis の wire adapter は対象外にする。外部 wire 動作は `apiDbQuality` / `apiRedisQuality` で検証する。
- coverage 閾値は `apps/api/build.sbt` の scoverage 設定を正とする。現行閾値は現在の実測値を下回らせない baseline であり、テスト追加時は原則として引き上げる。閾値を下げる場合は、同じ変更内で理由を文書化する。
- 分岐条件、error mapping、auth / CSRF、DTO codec、idempotency、repository contract、Redis queue payload、状態遷移に触れた場合は `apiCoverage` を通す。
- C2 は scoverage の branch coverage だけでは保証しない。複合条件を持つ下位ロジックでは、独立因子、入力、期待される外部契約を table-driven test で固定する。
- API テストのオラクルは HTTP status、Problem Details code、response DTO、DB row、repository contract、queue payload field、state transition、sanitized log のような外部契約で置く。`contains`、件数、成功/失敗 boolean だけで終える場合は、契約値の exact assertion も併置する。
- table / fixture は `final case class`、domain id、request / response DTO などの型で表し、境界変換そのものを検証する場合を除いて raw `Map[String, String]` や文字列連結を主オラクルにしない。
- 下位単体テストでは実時間 sleep、wall clock、共有 mutable state、外部サービスを使わない。時刻は test clock、外部境界は typed test double、外部サービスの wire 動作は `apiDbQuality` / `apiRedisQuality` に分離する。

## 5. OCR worker coverage / oracle

- `apps/ocr-worker` の C1/C2 baseline は `uv run pytest --cov=momo_ocr --cov-report=term-missing:skip-covered`
  で管理する。`pyproject.toml` の coverage 設定を正とし、branch coverage を有効にする。
- coverage 閾値は現行実測値を下回らせない baseline とする。閾値を下げる場合は、同じ変更内で理由を文書化する。
- 対象は手書きの `src/momo_ocr` とする。Docker/Redis/Postgres/native OCR の wire 動作は coverage の代用にせず、
  `uv run pytest -m integration` で別に検証する。
- C2 は aggregate coverage だけでは保証しない。screen type 判定、queue payload validation、failure code mapping、
  ack / pending / dead-letter 分岐、parser profile selection、fast-path 分岐、OCR postprocess の複合条件は、
  独立因子と期待される外部契約が分かる table-driven test にする。
- OCR worker の oracle は、`OcrDraftPayload`、warning code / field path、failure code / retryable /
  user action、queue ack / DLQ fields、DB row、画像メタデータ、debug artifact の存在と意味のある属性など、
  ユーザー確認または外部境界に出る契約で置く。`is not None`、`len(...)`、単なるファイル存在だけで終える場合は、
  契約値の exact assertion も併置する。
- test double / fixture は型付きの dataclass、Protocol、domain model、builder helper に寄せる。`Any` や broad `cast`
  は untyped external API 境界をテストに持ち込む箇所に限定する。
- 下位単体テストでは実時間 sleep、wall clock、ネットワーク、Docker、native OCR engine に依存しない。外部 runtime
  依存の smoke は `integration` marker へ分離し、skip / 未実行なら未検証として報告する。

## 6. OCR worker test doubles / fixtures

- `apps/ocr-worker` の runner / parser / domain / payload validation は原則 Detroit 派に寄せ、実 dataclass、
  実 parser、in-memory repository / consumer、実状態遷移を通す。London 派の interaction verification は
  Redis wire adapter、subprocess / native OCR API、process composition、worker loop の停止・retry 境界に限定する。
- stateful な test double は test ごとの pytest fixture / factory / local instance で生成し、module-scope の可変 singleton
  を共有しない。副作用記録を跨ぐ必要がある場合は、fixture teardown または `monkeypatch` の自動復元に閉じ込める。
- Redis、native OCR、subprocess、DB pool などの外部境界 double は、production 側の Protocol または必要最小の typed
  surface に合わせる。具象 client 型への broad `cast` で fake を押し込めない。
- fixture は「有効な queue payload」「Redis consumer factory」「画像 fixture」のように domain 上の意味が分かる名前にする。
  大量の inline dict / temporary image を増やす場合は、何を変えたかが呼び出し側で分かる builder / fixture に寄せる。
- pytest の `parametrize` は C2 / decision table を固定する場面で使い、単に件数を増やすために同値なケースを列挙しない。
  `tmp_path`、`monkeypatch`、fixture factory は test-scoped resource として使い、実時間や共有 filesystem path に依存しない。

## 7. API test doubles / fixtures

- `apps/api` の usecase / domain / HTTP 境界テストは原則 Detroit 派に寄せ、実DTO、実 codec、in-memory repository、実状態遷移を通す。London 派の interaction verification は、外部副作用、失敗注入、ログ観測、時刻、乱数、ネットワーク境界に限定する。
- stateful な test double は test ごとの `IO` / `Resource` / `ResourceFunFixture` で生成し、module-scope の `Ref` や可変状態を共有しない。共有が必要な Testcontainers は suite fixture に閉じ込め、各 test の cleanup を suite 側で保証する。
- 副作用を記録する double、失敗注入 double、固定 clock、OAuth / Redis / queue / repository / image store の境界 double は `apps/api/src/test/scala/momo/api/testing/TestDoubles.scala` に置く。spec 内の匿名 `new QueueProducer[IO]` などで都度作らない。
- domain/usecase の値 fixture は `apps/api/src/test/scala/momo/api/usecases/testing/MatchFixtures.scala` のように意味のある factory に集約する。大量の inline fixture を増やす場合は、呼び出し側が何を変えたか分かる builder / helper に寄せる。
- MUnit の `ResourceFunFixture` は HTTP app や外部 resource など取得・解放が必要な fixture に使う。単発の一時ディレクトリは `MomoCatsEffectSuite.tempDirectory` を使い、ファイルや外部リソースの cleanup を test 本体に書かない。

## 8. API independence / speed

- 通常の `sbt test` は `Integration` を除外し、file / test の実行順に依存しない並列安全な下位テストとして維持する。module-scope の可変状態、共有 writable path、外部サービス、suite 順序への依存を置かない。
- test-scoped state は各 test、`IO`、`Resource`、`ResourceFunFixture`、または typed test double factory の中で生成する。`Ref` / `IO.ref` は test ごとのインスタンスに閉じる場合だけ使う。
- writable な一時ファイル・ディレクトリは固定 `/tmp` path を使わず、`MomoCatsEffectSuite.tempDirectory` または capability-specific fixture から渡す。payload や domain 値としての path 文字列は、実ファイル I/O を伴わない場合に限る。
- 下位テストでは実時間 sleep、wall clock、polling timeout で同期しない。時刻は固定 clock、並行処理は `Deferred` / `Ref` / 明示的な状態観測、外部 wire 動作は integration gate で検証する。
- Testcontainers、Docker、PostgreSQL、Redis は通常テストに混ぜない。DB/Redis gate は forked かつ single-threaded にし、DB row、Redis stream / consumer group、namespace、一時ファイルを test / suite ごとに分離・cleanup する。
- 速度は domain / usecase / codec / request-response 変換の軽量テストを厚くすることで確保する。HTTP app 起動は request parsing、auth/CSRF、response mapping が oracle のときに絞り、DB/Redis wire 検証は必要な契約だけに限定する。

## 9. DB-backed API

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

## 10. 外部サービス依存

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
- OCR worker の Docker-backed Redis/Postgres、native `tesserocr`/tessdata、複数 adapter smoke は
  pytest の `integration` marker を付ける。通常の `uv run pytest` は `pyproject.toml` の `addopts` で
  `integration` を除外し、下位テストだけを速く決定的に保つ。外部 wire 動作は `uv run pytest -m integration`
  で明示的に実行する。
- OCR worker の複数 adapter を通す smoke は `e2e` marker も付け、数を絞る。状態遷移、payload validation、
  parser分岐は unit/contract test に寄せ、E2E smoke で全分岐を網羅しない。
- stateful な外部サービスを使う spec は、stream名、DB row、一時ファイル名をテストごとに分離する。
- sleep ではなく、publish後の読み取り、deferred promise、明示的な状態確認で同期する。

## 11. 品質ゲート

| 領域 | 標準ゲート |
|---|---|
| web | `pnpm --filter web generate:api`, `format:check`, `lint`, `typecheck`, `test:run`, `test:coverage`, `build` |
| api | `sbt apiQuality`, `sbt test`, C1/C2対象変更では `sbt apiCoverage`, 必要に応じて `apiDbQuality` / `apiRedisQuality` |
| ocr-worker | `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy`, `uv run pytest`, `uv run pytest --cov=momo_ocr --cov-report=term-missing:skip-covered`, 外部依存変更では `uv run pytest -m integration` |

CI では対象領域ごとに format、lint、typecheck/compile、test、必要な integration、build/OpenAPI check を実行する。ローカルでは変更範囲に応じて同等のゲートを選ぶ。
