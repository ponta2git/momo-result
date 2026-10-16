# テストアーキテクチャ

目的: 必要な品質証拠を、シンプルで保守できる実行構成へ割り当てる。test size、parallelism、coverage、cross-system contract evidence、CI artifact を扱い、日々の test 選択と oracle は `docs/test-rule.md`、command と変更 gate は `docs/dev-rule.md`、現在の実行構成は設定と CI workflow を正本とする。

## 1. Test Size

| Size | 境界 | 主な用途 |
| --- | --- | --- |
| S | process 内、外部 I/O なし | pure function、domain、parser、codec、ViewModel |
| M | process 内の組み合わせ、制御した double | HTTP app、usecase、component、MSW、in-memory adapter |
| L | 実 service、native dependency、別 process | PostgreSQL、object storage、OCR、worker process |
| XL | runtime image、browser、複数 process、resource 計測 | runtime smoke、Playwright、preemption、release resource gate |

size は実行時間ではなく、失敗時に疑う境界と依存範囲で決める。速い L test を M、遅い S test を L と呼ばない。下位 size は利用者価値に関係する分岐を詳しく、上位 size は接続、複合的な失敗、代表経路へ絞り、近い test の成功を変更経路の証拠にしない。

### 量感

- 選択した S / M evidence は同値 class、境界、状態遷移の代表を持ち、L / XL evidence は production boundary と主要 flow の代表へ絞る。大きい size ほど本数を少なくするが、固定比率や本数目標は置かない。
- 選択した共通実装の evidence は consumer 契約ごとの pattern を S / M で検証し、各利用箇所に同じ case を複製しない。複数 subsystem の組み合わせでだけ現れる価値は L / XL で直接確認する。
- 上位 test が下位 test より価値に近くても、原因を局所化する証拠まで一律に置き換えない。反対に、下位 test の集合で組み上がった利用者 flow を確認済みとはしない。

## 2. Coverage Model

aggregate coverage は、PR review と推移確認の非 blocking report とする。test failure は blocking のまま扱うが、aggregate coverage 値や増減だけで gate を失敗させない。

coverage は未確認の経路を探す補助であり、品質を一つの数値で表す目標ではない。測りやすい分岐や行を増やして数値を最適化せず、守る利用者結果と実行境界から証拠を選ぶ。

- CI は同じ test 集合を通常実行と coverage 実行で二重に回さない。report を作る場合は通常 test を coverage 付き実行へ置き換える。
- production deploy は coverage artifact の生成を待たず、同じ test 集合と変更対象の integration / smoke を release gate にする。
- 対象 file、除外、report path は tool 設定と生成 script を正本とし、この文書へ値を写さない。
- aggregate coverage は重要経路の証拠にしない。利用者影響が大きい module は、`docs/test-rule.md` の採用基準に従って decision table、property / contract test、または個別に妥当性を示した file / glob threshold を選ぶ。
- file / glob threshold を blocking にする場合は、対象の利用者価値と検出する failure mode を個別に示し、coverage 数値が専用 test より適切な oracle であることを先に確認する。repository 全体の数値から自動導入しない。
- external adapter、process isolation、resource、OCR accuracy は coverage 率ではなく専用の contract / smoke / dataset で評価する。

## 3. Subsystem Strategy

| 領域 | coverage が主に扱う範囲 | coverage 外で選ぶ主な oracle |
| --- | --- | --- |
| Web | pure logic、request transform、API wrapper、ViewModel、component state | 主要 flow、URL、cache lifecycle、download / save を component / Playwright で確認 |
| API | domain、usecase、codec、HTTP mapping | PostgreSQL / object storage と migration 前提を実 service で確認 |
| Processing Worker | pure calculation、parser、codec、state machine、decision table | DB、native OCR、parent / child process、cgroup、preemption、resource を専用 smoke で確認 |

- UI は line coverage や全表示状態の網羅より、入力保持・正しい送信先・保存・復旧・操作続行に関わる独立した scenario を優先する。採否は `docs/test-rule.md` の「UI の検証を選ぶ基準」に従う。
- DB adapter は coverage 対象へ含めること自体を品質目標にせず、production と同じ wire / transaction を通す。
- OCR accuracy は version 固定 dataset の項目別 oracle と差分で管理し、code coverage から未知画像への一般化を推測しない。
- 分析計算は golden、高精度参照、property を組み合わせる。既存実装の出力だけを正解にしない。
- performance / endurance の対象量、回数、上限は要求文書と private release gate を正本とし、public な coverage 設計へ複製しない。

### Webの実行境界

- `src`のVitestは値変換とcomponent / hook / MSWの証拠を扱う。appのroute接続とfeatureのresource lifecycleを区別し、後者の詳細をrouter suiteへ集約しない。
- `e2e/ui` はビルド済み Web と制御した HTTP 応答で focus・描画・非同期遷移を検証し、未定義 API 通信を失敗させる。DB や Worker を起動せず、mock 応答を保存・生成・配送の証拠にしない。
- `e2e/system` は production image の Web / API / Worker と実 DB・画像 storage・固定した通知 consumer を通す。session fixture は既存 SessionService で生成し、ブラウザは通常 cookie / CSRF を使う。OAuth provider の handshake と callback はこの fixture の保証範囲に含めない。
- `e2e/recovery` は制御 Worker を使い、受付応答の喪失や処理失敗から利用者が操作を続けられることを確認する。実 Worker と同じ job DB に同時起動しない。通知本文・全画像待ちなどの詳細は API を入口にする `e2e/contracts`、全体状態を変える上限 fixture は独立した通知契約 runner が所有する。
- E2E・Playwright設定もWebのtypecheckに含める。`scripts:check` の Node test は build checker の誤検出・未検出、runner の中断と所有 process の回収、診断の機密保護を観測する pipeline-integrity evidence とし、Vitest / coverage と分離する。別 process を起動する runner test は L であり、browser の利用者 flow や実 DB の接続成功を保証しない。
- API 生成の freshness は `contract:check`、生成された validator の受理・拒否はそれを使う decoder suite で観測する。generator の各内部関数へ同じ schema fixture を複製しない。build checker は実際の build にも接続し、正負 fixture の成功だけで最終 asset を確認済みにしない。
- 共通setupはunmount後にQueryClientを解放し、mockを復元してから実storageを清掃する。各suiteには共通cleanupを複製せず、個別に所有する資源の解放と未完了操作の完了待ちを残す。

採用・統合・廃止の判断は[テスト・品質規約](test-rule.md#2-品質証拠の採用維持削除)を参照する。現在のファイル配置・実行対象・並列数・commandは設定とCIが所有する。

### API / Workerの実行境界

- APIのservice suiteは通常testとコンパイル結果を共有しても、tag選択、fork、直列化を独立した設定scopeに置く。外部gateを実行した順序で後続の通常testの対象・隔離が変わらないようにする。
- 軽量 HTTP test は test source の `HttpTestRuntime` を明示して使う。InMemory adapter は test source に閉じ、production runtime の選択肢にしない。分析・Radar の状態再現は持たず、その保存状態を使う HTTP test は `PostgresHttpAppTestFixtures` で通常の `ApiApp` を組み立てる。
- 実 DB の HTTP fixture は既存 `IntegrationSuite` の隔離 DB と直列化を共有し、各 test の保存状態と変更した account を回収する。DB 固有の transaction、lock、rollback、job は実 DB suite が所有する。
- 存続する double と production adapter に共通する consumer 契約は必要な代表例だけ共有できる。全 adapter の対になる suite を作らず、非永続 adapter との共通化のために oracle を弱めない。
- 設定の解釈は入力を注入できる純粋境界で検証し、process全体の環境変数を書き換えて並列testを制御しない。filesystem / cgroup / child processの観測は実adapterを通す証拠として分ける。

## 4. Cross-System Contract Evidence

| 契約 | 選択時の主な production boundary |
| --- | --- |
| API -> Web | OpenAPI generation、generated type、代表 request / response |
| API -> OCR Worker | JSON Schema、入力 snapshot の共有 fixture、DB lifecycle |
| API -> Analysis Worker | DB request / job contract、version capability、起床通知 |
| Analysis Worker -> API / Web | artifact schema、version pinning、bounded read、非対応 version |
| DB consumers -> shared DB | migration 適用済み PostgreSQL、contract spec、repository integration |
| runtime -> user | image smoke、health / readiness、主要 E2E、resource / isolation |

この表は一行ごとに新しい contract test を要求しない。契約 fixture を evidence に選ぶ場合は producer と consumer の両 validator を通し、同じ意味を各言語の手書き fixture へ複製しない。共有 schema と、専門正本が定義している場合だけ canonical fixture を使う。選定は `docs/test-rule.md`、境界の意味は各専門正本に従う。

## 5. Parallelism

- test は並列実行を既定とし、resource、DB row、schema、stream、object、file、port、clock を test ごとに隔離する。
- 共有状態、順序、resource 競合そのものを検証する場合、または隔離コストが証拠価値を上回る場合だけ直列化し、理由と対象 scope を test 設定の近くへ残す。
- 独立した suite や準備は並列化し、依存する処理と同じ資源へ干渉する処理は順序を守る。並列数を増やすための過剰な隔離機構や重複 setup を作らず、必要な証拠を効率よく得られる構成を選ぶ。
- job の並列化と待ち時間の扱いは `docs/dev-rule.md` の Developer Wait / Parallel Execution に従う。

## 6. CI Artifacts

- workflow は gate の依存関係、権限、service、artifact の受け渡しを所有する。`scripts/ci` の Shell は外部 command、環境変数、file の受け渡し、終了状態と実行順序を扱い、アプリの業務判断は各 subsystem に置く。
- API / Web のローカル起動・Web build 補助は `apps/web/scripts`、複数 service の E2E 環境管理と runtime HTTP smoke は root の `scripts/e2e` に置く。これらは Node が直接実行できる `.mts` とし、native type stripping とは別に Web の scripts 用 tsconfig で型検査する。root E2E も Web の lint・format・scripts test に含める。
- 構造化された CI data の集計・秘匿化・来歴検証と metadata 生成は `scripts/tools/cmd/ci-tool` に集約する。producer と consumer は同じ検証規則を使い、後続 release が以前の metadata を読める契約を保つ。CLI の入力・出力・終了値は [command の説明](../scripts/tools/cmd/ci-tool/README.md) から辿れる。
- 独立した診断・評価用 Go command も `scripts/tools/cmd`、本番 runtime の process 管理と probe は独立 module の `apps/runtime` に置く。CI 専用の集計・判定を runtime binary に含めない。
- `scripts/ci/test-*.sh` は分類、来歴、結果集約、実行の調整を観測する pipeline-integrity evidence とする。外部 command の double は実 container、DB、provider 接続の成功を保証しない。ローカル候補の起動確認と配備後の公開 edge の確認は、それぞれの対象へ接続する smoke で証拠を取る。
- Shell の contract suite は共通 runner で CI tool を一度 build してから独立した process で実行し、一つの失敗で他の結果を失わない。fixture と command double は各 suite が所有し、ローカルと CI は同じ実行入口を使う。変更分類には test 自体に加え、検証される運用 script と実行入口の変更も接続する。
- coverage artifact は PR review と推移確認の補助であり、integration / smoke の代わりにしない。
- artifact は失敗の診断と変更の確認に必要なものを残し、生成 script と workflow が path / format を所有する。人間が概要から必要な詳細へ進めるようにし、利用先のない report や同じ内容の別形式を増やさない。
- coverage report を有効にした job は test failure を隠さず、artifact upload failure と品質 failure を区別する。
- retry-pass は green としてよい。ただし retry を許す runner は、test ID、最初の失敗、attempt 数を結果から追跡可能にし、再現に必要な trace / log を artifact にする。PR summary への集約は diagnostic report として導入できるが、観測可能性と利用方法を評価する前に blocking gate にしない。
- Processing Worker に coverage artifact を導入する場合も、実 service / process gate を coverage へ置き換えない。
- provider resource、費用、実測 memory / timing、非公開 OCR dataset は public artifact にせず private release evidence へ置く。

coverage baseline と長期推移保存は、具体的な判断に役立ち、維持コストに見合う場合にだけ導入する。定性的に扱うべき品質を数値化するためには追加せず、将来案を現行 gate として記述しない。
