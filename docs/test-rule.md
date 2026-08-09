# テスト・品質規約

目的: 変更種別ごとのテスト選択、oracle、品質ゲート判断の正本。

読む条件:

- テストを追加・修正する。
- 変更範囲に対して必要な gate を選ぶ。
- 障害対応で再発防止テストを決める。

参照:

- コマンド: `docs/dev-rule.md`
- coverage / CI artifact / test size: `docs/test-architecture.md`
- DB所有権: `docs/db-rule.md`
- Redis/OCR queue契約: `docs/redis-streams-ocr-contract.md`
- 最終チェック: `docs/post-mortem/lessons.md`

## 1. Principles

- 変更した実行経路を直接通す。近いテストの成功で代用しない。
- テスト層の責務を混同しない。unit、HTTP、repository integration、E2E は別の失敗を捕まえる。
- 障害対応では、報告された操作、query、endpoint、usecase分岐そのものを回帰テストに含める。
- 外部サービス依存の検証が skip / 未実行なら、その挙動は未検証として報告する。
- assertion はユーザー可視状態、request / response DTO、DB row、queue payload、state transition、Problem Details などの外部契約に置く。
- `exists`、`length > 0`、成功/失敗 boolean だけで終えない。
- 非同期は sleep / wall clock で同期しない。deferred promise、test clock、状態観測、wire integration gate を使う。
- 共有 mutable state、固定 writable path、module-scope store は test ごとに分離・cleanup する。

## 2. Test Layers

| 層 | 捕まえるもの | Gate |
|---|---|---|
| domain / pure logic | 不変条件、分岐、validation、parser、ViewModel | `sbt test`, `uv run pytest`, `cargo test`, Vitest |
| usecase / app service | 状態遷移、副作用境界、repository contract | `sbt test`, `uv run pytest`, `cargo test` |
| HTTP/API | request parsing、auth/CSRF、response encoding、error mapping | `sbt test` |
| web component/page | UI状態、入力操作、APIエラー表示、query cache lifecycle | `pnpm test:run` |
| PostgreSQL repository | SQL syntax、transaction、PostgreSQL固有挙動 | `sbt apiDbQuality` |
| DB contract | table / column / seed / nullable / default | `sbt apiDbQuality` |
| Redis integration | Redis Streams wire 動作、ack/claim/retry | `sbt apiRedisQuality`, worker integration |
| OCR worker | 画面種別判定、解析、payload validation、失敗処理 | `uv run pytest` |
| analysis worker | 数値正確性、job状態、timeout、成果物の原子的公開 | `cargo test`, worker integration |
| Runtime / E2E smoke | nginx / API / DB / Redis / worker / browser 結合、ログイン後主要UX | deploy workflow, Playwright |

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
- UI表示や操作経路を変える refactor では、対象画面の Testing Library test または E2E smoke を追加・更新する。見た目だけの分割でも、ユーザー可視の loading、empty、error、success 状態が変わるなら oracle を置く。
- UI の semantic token、余白、motion、z-index、touch target を変えた場合は `pnpm --filter web lint` で UI consistency check を通し、PC / mobile で主要操作が隠れたり重なったりしないことを Playwright で確認する。

### Test Foundation / Doubles

- 共通 setup、QueryClient、MSW lifecycle、factory、DOM double は既存の `apps/web/src/test/` 配下の helper を使う。
- MSW の module-scope store を増やしたら reset 対象へ登録する。
- 出現待ちは `findBy*` を優先する。`waitFor` は disappearance、複数 assertion、non-DOM assertion に限る。
- pure logic は `node`、DOM / browser API / direct fetch 境界は `jsdom` のように、必要な test environment を明示する。
- `console.error` / `console.warn` は失敗扱い。React `act` warning、duplicate key、未実装ブラウザ副作用を放置しない。
- test double は production adapter の契約を弱めない。通すだけの mock より、request body、response shape、状態遷移を観測できる double を使う。
- 装飾画像や装飾用 `data-*` 属性そのものを component / page test の主 oracle にしない。画像が機能要件なら、アクセシブル名、操作結果、download、navigation などユーザー可視の契約で検証する。

### Locator / E2E

- Playwright locator は、実際のアクセシブルロールと名前を組み合わせて対象を一意にする。
- フォーム項目とナビゲーション、tab と button など、同じ表示名が複数ロールに現れる画面では `getByLabel` や広い text locator だけで選ばず、`getByRole("combobox" | "tab" | "button" | "link", { name })` で操作対象を明示する。
- Playwright E2E smoke は、開催作成、OCR取り込み開始、OCRレビュー確定、試合詳細、CSV/TSV出力、マスタ/alias管理などの主要UXを狭く通す。
- E2E assertion は見出しの存在だけでなく、API response、URL、download scope、DB-backedに保存された結果など、壊れ方を捕まえる外部契約に置く。

## 4. API Rules

- usecase / domain / HTTP 境界テストは、実DTO、実 codec、in-memory repository、実状態遷移を優先する。
- interaction verification は外部副作用、失敗注入、ログ観測、時刻、乱数、ネットワーク境界に限定する。
- stateful test double は test ごとの `IO` / `Resource` / fixture で生成する。module-scope の `Ref` や可変状態を共有しない。
- 値 fixture は意味のある factory / builder に寄せる。境界変換そのものを検証する場合を除き、raw map や文字列連結を主オラクルにしない。
- HTTP app 起動は request parsing、auth/CSRF、response mapping が oracle のときに絞る。
- architecture rule を追加した場合、可能なら `ApiEndpointsArchitectureSpec`、`ApiRuntimeArchitectureSpec`、または lint 相当の検査へ固定する。
- Tapir security endpoint、Doobie named row mapping、戦績比較 engine / presenter 境界などの横断規約を追加した場合は、代表経路の unit / HTTP / integration test に加え、import 禁止や文字列パターン検査で architecture spec へ固定する。
- Ciris / Iron による設定・endpoint境界制約を変更した場合は、対象 loader / codec の unit test に加え、`ConfigArchitectureSpec`、`BoundaryIdSpec`、該当 codec spec で「手書き parser へ戻っていないこと」と「不正 raw value を境界で落とすこと」を固定する。

### DB-backed API

PostgreSQL repository、Doobie query、DB table/column、migration 前提に触れたら:

- endpoint / usecase / repository / method を特定する。
- 新しい table / column / seed / nullable / default 前提は `DbContractSpec` に追加する。
- 変更した repository method を Testcontainers PostgreSQL で実行する。
- 同一 transaction で FK 関連 row を作成・更新する method は、成功 path と保存後の linked row values を検証する。
- 新しい table に書き込む integration test を追加したら cleanup 対象も更新する。
- SQL shape と domain 変換を分けた場合、row mapping の成功 path と不正 DB 値の扱いを repository unit または integration test で確認する。tuple mapping を named row へ変えた場合も、対象 query を実PostgreSQLで実行し、必要なら repository architecture spec へ禁止パターンを追加する。

### Performance-sensitive analytics

集計API、推薦API、ドリルダウン、モデル計算など、純粋計算の追加・変更でCPUまたは応答時間が増える可能性がある場合:

- 画面名や変更ファイルではなく、実際に同時実行されるAPI、job、worker、engineの経路を特定する。
- 戦績比較、振り返り、ドリルダウンAPIで分析engineが実行されず、同じ作品成果物versionを読むことを
  architecture / usecase / HTTP testで固定する。
- 固定4名、全有効スコープ、現在データ量の2倍かつ最低500試合/作品の決定論的fixtureを用意し、
  correctness testとは別に処理時間、計算回数、peak memoryを検証する。
- 上限fixtureを単一実行枠で100回連続実行し、OOM、runtime再起動、未解放memoryの増加傾向がないことを
  本番同等runtimeで測定する。provider固有の上限値と実測結果はprivateに残す。
- 同じ作品成果物内で同一の高負荷計算が通常集計、振り返り、ドリルダウンごとに重複していないことを
  直接検証する。片方のunit testやresponse shape testの成功で代用しない。
- 定義済みの対象なし・件数不足・モデル非採用は正常成果物として固定する。予期しない1スコープの
  失敗では作品成果物全体が失敗し、部分公開せず直前成功成果物を維持することを固定する。
- runtime smoke / E2Eが機能成功だけを確認している場合、CPU回復や性能予算を検証したとは報告しない。外部メトリクスが未取得・未実行なら未検証として明記する。
- rollbackでは、対象commitのartifact identityだけでなく、削除対象のユーザー経路とサーバー実行経路が消えたことを直接確認できる回帰ケースを用意する。

実DB実行が特に必要なSQL:

- `UNION` / `INTERSECT` / `EXCEPT`
- `DISTINCT`
- window function
- JSON operator
- dynamic fragment
- 複数 table をまたぐ filter / order / limit

## 5. OCR Worker Rules

- runner / parser / domain / payload validation は、実 dataclass、実 parser、in-memory repository / consumer、実状態遷移を優先する。
- interaction verification は Redis wire adapter、native OCR API、process composition、worker loop の停止・retry 境界に限定する。
- Docker、Redis、PostgreSQL、native OCR engine、tessdata は integration marker へ分離する。
- screen type 判定、queue payload validation、failure code mapping、ack / pending / DLQ、parser profile selection、OCR postprocess の複合条件は table-driven test にする。
- oracle は OCR draft payload、warning / failure code、queue ack / DLQ field、DB row、画像メタデータなど外部契約に置く。
- fixture は domain 上の意味が分かる名前にし、大量の inline dict / temporary image を増やさない。

## 6. Analysis Worker Rules

- 純粋計算はDB、Redis、clock、process、wire DTOから分離し、数式、分母、同値、丸め、境界、品質状態を
  table-driven testとproperty testで固定する。
- 浮動小数点結果は、要求から手計算できるgolden fixture、高精度参照計算、数学的性質のいずれかを
  oracleにする。現行Scala値は差分検出に使えるが、より正確な値を否定する唯一のoracleにしない。
- Scala版と意図的に異なる結果は、正確性の証拠、影響fixture、algorithm version更新を同じ変更で残す。
  意図しない丸め差、入力順による揺れ、seed非再現は不具合とする。
- job、intent / outbox、lease、artifact repositoryは実PostgreSQLで、publish、pending、claim、ackは
  実Redisで検証する。unit doubleだけでwire動作を検証済みとしない。
- 試合mutationと再計算intentの同一transaction、連続mutationのcoalescing、重複deliveryの冪等性、
  terminal DB write before ack、stale lease回収をintegration testで固定する。
- transient DB / queue failureの最大3回再試行と、timeout・入力契約違反・決定論的失敗の非再試行を
  decision tableで検証する。
- 子processの正常終了、異常終了、hard timeout、親process停止を実process testで通し、部分成果物、
  zombie process、二重公開を残さないことを確認する。
- 将来OCR preemptionを実装するときは、OCRから分析へのpreemption、逆方向の禁止、失敗回数非加算、
  最新版への再queue、commit critical sectionを実process / integration testで固定する。
- terminal jobの終了後45日保持と管理画面の直近3件取得は別契約として検証し、表示件数をDB削除条件に
  流用せず、古い `queued` / `running` jobをcleanupしない。
- resource/performance gateは機能gateと分け、本番同等runtime、release build、実際のresource上限で行う。
  timeout値は通常、上限、cold start、連続実行のp50 / p95 / p99 / 最大時間を測定後に決める。

## 7. Coverage / C2

- サブシステム別の対象範囲、テストサイズ、CI artifact 方針は `docs/test-architecture.md` を正とする。
- coverage 閾値は各設定ファイルを正とする。
  - web: `apps/web/vite.config.ts`
  - api: `apps/api/build.sbt`
  - ocr-worker: `apps/ocr-worker/pyproject.toml`
  - analysis-worker: 実装時にCargo coverage設定を追加し、その設定を正本とする。
- aggregate coverage だけで重要経路を保証しない。blast radius が大きい下位モジュールは file / glob 単位または明示的な table test で固定する。
- C2 は coverage tool の branch coverage だけでは保証しない。`&&`、`||`、三項演算子、mode discriminator、`enabled`、`isFetching`、`isError`、cached data 有無などは decision table で独立因子と期待値を示す。
- 型耐性が重要な fixture は生成型、domain型、`satisfies` などで shape 変更を型エラーにする。

## 8. External Services

- PostgreSQL-backed spec は `Integration` と `DbIntegration` tag を付け、`apiDbQuality` で実行する。
- Redis-backed spec は `Integration` と `RedisIntegration` tag を付け、`apiRedisQuality` で実行する。
- API integration tag は `apps/api/src/test/scala/momo/api/testing/TestTags.scala` を正本とし、spec 内で直接 `new munit.Tag(...)` しない。
- PostgreSQL-backed spec は `IntegrationSuite`、Redis-backed spec は `RedisIntegrationSuite` へ寄せる。
- OCR worker integration は pytest の `integration` marker を付ける。複数 adapter smoke は必要最小限にし、状態遷移・payload validation・parser分岐は unit/contract test に寄せる。
- analysis workerのPostgreSQL / Redis integrationは通常の `cargo test` と分離し、CI上で実サービスを
  起動する明示gateを持つ。
- 外部サービスを使う spec は、stream名、DB row、一時ファイル名、worker id を test / suite ごとに分離する。

## 9. Quality Gates

標準 gate は `docs/dev-rule.md` の Change Gates を正とする。

追加判断:

- API / web DTO 契約を変えたら OpenAPI生成物と web generated type を更新する。
- API coverage 対象ロジックを変更したら `docs/dev-rule.md` の `sbt apiCoverage` を実行する。
- Redis Streams / OCR queue 契約を変えたら `docs/redis-streams-ocr-contract.md` の Required Tests を実行する。
- 戦績分析workerを変えたらformat、Clippy、unit test、PostgreSQL / Redis integration、release buildを
  実行する。数式または候補採用を変えたらalgorithm version判定も行う。
- DB schema 前提を変えたら `docs/db-rule.md` の Consumer Contract を満たす。
- `docs/post-mortem/lessons.md` に該当するカードがあれば、テスト選択と最終報告に反映する。
- 性能事故・高負荷計算の変更では、機能テストの成功と性能回復の証拠を分けて報告する。
- 戦績分析の初回公開とresource影響変更では、private運用要件の本番同等resource/performance gateと
  timeout設定を満たすまでリリース可としない。
