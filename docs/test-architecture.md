# テスト実行設計

目的: 必要な品質証拠を、シンプルで保守できる実行構成へ割り当てる。test size、parallelism、coverage、cross-system contract evidence、CI artifact を扱う。日々の test 選択と oracle は [テスト・品質規約](test-rule.md)、command と変更 gate は [開発作業規約](dev-rule.md)、script と tool の配置は [アーキテクチャ](architecture.md#scripts--tooling-boundaries)、現在の実行構成（対象 file、除外、並列数、tag、report path、command）は設定と CI workflow を正本とする。

## Test Size

| Size | 境界 | 主な用途 |
| --- | --- | --- |
| S | process 内、外部 I/O なし | pure function、domain、parser、codec、ViewModel |
| M | process 内の組み合わせ、制御した double | HTTP app、usecase、component、MSW、in-memory adapter |
| L | 実 service、native dependency、別 process | PostgreSQL、object storage、OCR、worker process |
| XL | runtime image、browser、複数 process、resource 計測 | runtime smoke、Playwright、queued priority、release resource gate |

size は実行時間ではなく、失敗時に疑う境界と依存範囲で決める。大きい size ほど本数を絞り、対象ごとの検出価値に基づいて必要な証拠を選ぶ。選択した共通実装の evidence は consumer 契約ごとの pattern を S / M に集約し、利用箇所でその証拠を再利用する。複数 subsystem の組み合わせでだけ現れる価値は、下位 test の集合ではなく L / XL で組み上がった利用者 flow を直接確認する。

## Coverage Model

aggregate coverage は、PR review と推移確認の非 blocking report とする。test failure は blocking のまま扱い、aggregate coverage 値や増減は report に留める。coverage は未確認の経路を探す補助であり、品質を一つの数値で表す目標ではない。

- CI は同じ test 集合の通常実行と coverage 実行を目的に合う方へまとめ、report を作る場合は通常 test を coverage 付き実行へ置き換える。
- production deploy は同じ test 集合と変更対象の integration / smoke を release gate にし、coverage artifact の生成とは独立して進める。
- 利用者影響が大きい module は、[テスト・品質規約](test-rule.md#品質証拠の採用維持削除) の採用基準に従って decision table、property / contract test、または個別に妥当性を示した file / glob threshold を選ぶ。
- file / glob threshold を blocking にする場合は、対象の利用者価値と検出する failure mode を個別に示し、coverage 数値が専用 test より適切な oracle であることを先に確認する。導入は対象ごとの個別判断で行う。
- external adapter、process isolation、resource、OCR accuracy は coverage 率ではなく専用の contract / smoke / dataset で評価する。

## Subsystem Strategy

| 領域 | coverage が主に扱う範囲 | coverage 外で選ぶ主な oracle |
| --- | --- | --- |
| Web | pure logic、request transform、API wrapper、ViewModel、component state | 主要 flow、URL、cache lifecycle、download / save を component / Playwright で確認 |
| API | domain、usecase、codec、HTTP mapping | PostgreSQL / object storage と migration 前提を実 service で確認 |
| Processing Worker | pure calculation、parser、codec、state machine、decision table | DB、native OCR、parent / child process、cgroup、queued priority、resource を専用 smoke で確認 |

- DB adapter の品質は、coverage ではなく production と同じ wire / transaction を通すことで確かめる。
- performance / endurance の対象量、回数、上限は要求文書と private release gate を正本とし、本書ではその正本を参照する。

### Web の実行境界

- `src` の Vitest は値変換と component / hook / MSW の証拠を扱う。app の route 接続と feature の resource lifecycle を区別し、後者の詳細は feature 側の suite に置く。
- `e2e/ui` はビルド済み Web と制御した HTTP 応答で focus・描画・非同期遷移を検証し、未定義 API 通信を失敗させる。DB や Worker を起動せず、mock 応答を保存・生成・配送の証拠にしない。
- `e2e/system` は production image の Web / API / Worker と実 DB・画像 storage・固定した通知 consumer を通す。session fixture は既存 SessionService で生成し、ブラウザは通常 cookie / CSRF を使う。OAuth provider の handshake と callback はこの fixture の保証範囲に含めない。
- session fixture は Test とは別の sbt config に置き、Runtime の build で compile 済みの API を再利用する Dockerfile target で JAR だけを作る。runner は候補 Runtime image の JVM と staged library で各 suite の新しい DB に対して実行し、本番 image には fixture class を含めない。制御 Worker（`e2e-test` target）も E2E job の外で build する。producer は artifact と来歴を作り、CI は producer の run・attempt・commit・hash と Runtime image ID との対応を検証し、runner は検証済みの入力を実行して可変な隔離環境だけを所有・回収する。
- `e2e/recovery` は制御 Worker を使い、受付応答の喪失や処理失敗から利用者が操作を続けられることを確認する。実 Worker と同じ job DB に同時起動しない。通知本文・全画像待ちなどの詳細は API を入口にする `e2e/contracts`、全体状態を変える上限 fixture は独立した通知契約 runner が所有する。
- 各 suite の command、必要な image、環境変数は [開発作業規約の E2E Suites](dev-rule.md#e2e-suites) に従う。
- `scripts:check` の Node test は build checker の誤検出・未検出、runner の中断と所有 process の回収、診断の機密保護を観測する pipeline-integrity evidence とし、Vitest / coverage と分離する。別 process を起動する runner test は L であり、browser の利用者 flow や実 DB の接続成功を保証しない。
- 生成された validator の受理・拒否の観測は、それを使う decoder suite に集約する。build checker は実際の build にも接続し、最終 asset の確認は正負 fixture に加えて実際の build で行う。
- 共通 setup は unmount 後に QueryClient を解放し、mock を復元してから実 storage を清掃する。各 suite は共通 cleanup に任せ、個別に所有する資源の解放と未完了操作の完了待ちだけを持つ。

### API / Worker の実行境界

- API の service suite は通常 test とコンパイル結果を共有しても、tag 選択、fork、直列化を独立した設定 scope に置く。外部 gate を実行した順序によらず、後続の通常 test の対象・隔離を一定に保つ（session 内の設定が後続 command へ漏れた経緯は `apps/api/build.sbt` のコメントにある）。
- `apiDbQuality` は同じ pinned migration source から legacy / canonical の境界までを別 process・別 DB に適用する。canonical suite は通常の runtime composition を通し、旧 URL・principal・replay・順序・immutable payload と、UUID 参照を使う次の更新を確認する。起動 probe の派生契約は `node apps/api/scripts/generate-identity-schema-contract.mjs /path/to/momo-db/drizzle` で DB 所有 snapshot から生成する。legacy 境界の suite は API が受理する legacy / canonical の schema 契約の受理・拒否を観測する証拠であり、canonical identity への切替手順を規約から撤去した後も維持する。API が legacy mode の受理をやめる変更で、[DB 規約の Identifiers and Decoding](db-rule.md#identifiers-and-decoding) とともに見直す。
- 軽量 HTTP test は test source の `HttpTestRuntime` を明示して使う。InMemory adapter は test source に閉じ、production runtime の repository は PostgreSQL adapter を使う。分析・Radar の状態は InMemory で再現せず、その保存状態を使う HTTP test は `PostgresHttpAppTestFixtures` で通常の `ApiApp` を組み立てる。
- 実 DB の HTTP fixture は既存 `IntegrationSuite` の隔離 DB と直列化を共有し、各 test の保存状態と変更した account を回収する。DB 固有の transaction、lock、rollback、job は実 DB suite が所有する。
- 存続する double と production adapter に共通する consumer 契約は、必要な代表例だけを共有できる。共有する場合も oracle の強さは production adapter に合わせる。
- 設定の解釈は入力を注入できる純粋境界で検証し、process 全体の環境変数を書き換えて並列 test を制御しない。filesystem / cgroup / child process の観測は実 adapter を通す証拠として分ける。

## Cross-System Contract Evidence

| 契約 | 選択時の主な production boundary |
| --- | --- |
| API -> Web | OpenAPI generation、generated type、代表 request / response |
| API -> OCR Worker | JSON Schema、入力 snapshot の共有 fixture、DB lifecycle |
| API -> Analysis Worker | DB request / job contract、version capability、起床通知 |
| Analysis Worker -> API / Web | artifact schema、version pinning、bounded read、非対応 version |
| DB consumers -> shared DB | migration 適用済み PostgreSQL、contract spec、repository integration |
| runtime -> user | image smoke、health / readiness、主要 E2E、resource / isolation |

この表は選択した証拠が通す境界の一覧であり、既存の証拠を含め、変更に必要な検証を選ぶ。test の追加はテスト・品質規約の採用基準で判断する。契約 fixture を evidence に選ぶ場合は producer と consumer の両 validator を通し、各言語は同じ共有 fixture を使う。共有 schema と、専門正本が定義している場合だけ canonical fixture を使う。

## Parallelism

- test は並列実行を既定とし、resource、DB row、schema、stream、object、file、port、clock を test ごとに隔離する。
- 共有状態、順序、resource 競合そのものを検証する場合、または隔離コストが証拠価値を上回る場合だけ直列化し、理由と対象 scope を test 設定の近くへ残す。隔離機構と setup は証拠価値に見合う範囲に留める。
- 作業単位の並列化と待ち時間の扱いは [開発作業規約の Parallel Execution](dev-rule.md#parallel-execution) に従う。

## CI Artifacts

- `scripts/ci/test-*.sh` は分類、来歴、結果集約、実行の調整を観測する pipeline-integrity evidence とする。外部 command の double は実 container、DB、provider 接続の成功を保証しない。ローカル候補の起動確認と配備後の公開 edge の確認は、それぞれの対象へ接続する smoke で証拠を取る。
- Shell の contract suite の fixture と command double は各 suite が所有し、ローカルと CI は同じ実行入口を使う。変更分類には test 自体に加え、検証される運用 script と実行入口の変更も接続する。
- artifact は失敗の診断と変更の確認に必要なものを残し、生成 script と workflow が path / format を所有する。report は利用先と内容に応じて必要な形式を選び、同じ内容の重複はまとめる。coverage report を有効にした job も test failure をそのまま示し、artifact upload failure と品質 failure を区別する。
- retry-pass は green としてよい。ただし retry を許す runner は、test ID、最初の失敗、attempt 数を結果から追跡可能にし、再現に必要な trace / log を artifact にする。PR summary への集約は diagnostic report として導入でき、blocking gate にするのは観測可能性と利用方法を評価した後とする。
- Processing Worker に coverage artifact を導入する場合も、実 service / process gate は維持する。
- provider resource、費用、実測 memory / timing、非公開 OCR dataset は private release evidence に置く。

coverage baseline と長期推移保存は、具体的な判断に役立ち、維持コストに見合う場合にだけ導入する。定性的に扱うべき品質は定性的に扱い、将来案は現行の gate と区別して記述する。
