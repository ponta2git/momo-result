# テストアーキテクチャ

目的: test size、証拠の量感、parallelism、coverage、cross-system 契約、CI artifact の責務を定義する。日々の test 選択と oracle は `docs/test-rule.md`、command と変更 gate は `docs/dev-rule.md`、現在の実行構成は test / coverage 設定と CI workflow を正本とする。

## 1. Test Size

| Size | 境界 | 主な用途 |
| --- | --- | --- |
| S | process 内、外部 I/O なし | pure function、domain、parser、codec、ViewModel |
| M | process 内の組み合わせ、制御した double | HTTP app、usecase、component、MSW、in-memory adapter |
| L | 実 service、native dependency、別 process | PostgreSQL、Redis、object storage、OCR、worker process |
| XL | runtime image、browser、複数 process、resource 計測 | runtime smoke、Playwright、preemption、release resource gate |

size は実行時間ではなく、失敗時に疑う境界と依存範囲で決める。速い L test を M、遅い S test を L と呼ばない。下位 size は利用者価値に関係する分岐を詳しく、上位 size は接続、複合的な失敗、代表経路へ絞り、近い test の成功を変更経路の証拠にしない。

### 量感

- S / M は同値 class、境界、状態遷移の代表を持ち、L / XL は production boundary と主要 flow の代表へ絞る。大きい size ほど本数を少なくするが、固定比率や本数目標は置かない。
- 共通実装は consumer 契約ごとの pattern を S / M で検証し、各利用箇所に同じ case を複製しない。複数 subsystem の組み合わせでだけ現れる価値は L / XL で直接確認する。
- 上位 test が下位 test より価値に近くても、原因を局所化する証拠まで一律に置き換えない。反対に、下位 test の集合で組み上がった利用者 flow を確認済みとはしない。

## 2. Coverage Model

aggregate coverage は、PR review と推移確認の非 blocking report とする。test failure は blocking のまま扱うが、aggregate coverage 値や増減だけで gate を失敗させない。

- CI は同じ test 集合を通常実行と coverage 実行で二重に回さない。report を作る場合は通常 test を coverage 付き実行へ置き換える。
- production deploy は coverage artifact の生成を待たず、同じ test 集合と変更対象の integration / smoke を release gate にする。
- 対象 file、除外、丸め、report path は tool 設定と生成 script を正本とし、この文書へ値を写さない。
- aggregate coverage は重要経路の証拠にしない。利用者影響が大きい module は、`docs/test-rule.md` の採用基準に従って decision table、property / contract test、または個別に妥当性を示した file / glob threshold を選ぶ。
- file / glob threshold を blocking にする場合は、対象の利用者価値と検出する failure mode を個別に示し、coverage 数値が専用 test より適切な oracle であることを先に確認する。repository 全体の数値から自動導入しない。
- external adapter、process isolation、resource、OCR accuracy は coverage 率ではなく専用の contract / smoke / dataset で評価する。

## 3. Subsystem Strategy

| 領域 | coverage が主に扱う範囲 | coverage 外で選ぶ主な oracle |
| --- | --- | --- |
| Web | pure logic、request transform、API wrapper、ViewModel、component state | 主要 flow、URL、cache lifecycle、download / save を component / Playwright で確認 |
| API | domain、usecase、codec、HTTP mapping | PostgreSQL / Redis / object storage と migration 前提を実 service で確認 |
| Processing Worker | pure calculation、parser、codec、state machine、decision table | DB / Redis、native OCR、parent / child process、cgroup、preemption、resource を専用 smoke で確認 |

- UI は line coverage より loading / empty / error / success / mutation の scenario coverage を優先する。
- DB / queue adapter は coverage 対象へ含めること自体を品質目標にせず、production と同じ wire / transaction を通す。
- OCR accuracy は version 固定 dataset の項目別 oracle と差分で管理し、code coverage から未知画像への一般化を推測しない。
- 分析計算は golden、高精度参照、property を組み合わせる。既存実装の出力だけを正解にしない。
- performance / endurance の対象量、回数、上限は要求文書と private release gate を正本とし、public な coverage 設計へ複製しない。

## 4. Cross-System Contracts

| 契約 | 必要な境界 |
| --- | --- |
| API -> Web | OpenAPI generation、generated type、代表 request / response |
| API -> OCR Worker | JSON Schema、producer / consumer fixture、Redis wire、DB lifecycle |
| API -> Analysis Worker | DB consumer contract、queue schema、version capability、Redis wire |
| Analysis Worker -> API / Web | artifact schema、version pinning、bounded read、非対応 version |
| DB consumers -> shared DB | migration 適用済み PostgreSQL、contract spec、repository integration |
| runtime -> user | image smoke、health / readiness、主要 E2E、resource / isolation |

契約 fixture は producer と consumer の両 validator を通す。同じ意味を各言語の手書き fixture へ複製せず、共有 schema / canonical fixture を使う。どの contract test が必要かは各専門正本を参照する。

## 5. Parallelism / Developer Wait

- test job と独立した gate は並列実行を既定とする。直列化は、共有状態、順序、resource 競合そのものを検証する場合、または隔離コストが証拠価値を上回る場合に限り、対象を最小 scope に閉じる。
- 最適化対象は runner の CPU 合計ではなく developer 待ち時間とする。setup、依存取得、build、同一 test 集合の重複実行を含む critical path を見て改善し、速い check でも価値が薄ければ削除候補にする。
- CI の merge-ready duration は workflow / job timestamp から計測できるため、まず非 blocking report として扱う。数値予算は履歴と変動要因を評価してから定める。
- first actionable failure は、最初の失敗 step 時刻を proxy として試行計測できる。ただし product failure、flake、provider / setup failure の分類なしには一意に測れないため、計測可能性と review 利用価値を確認するまで gate や目標値にしない。
- local wait は代表環境の推計でよく、個々の developer の操作 telemetry を導入しない。

## 6. CI Artifacts

- coverage artifact は PR review と推移確認の補助であり、integration / smoke の代わりにしない。
- artifact は raw summary、review 用 summary、必要な HTML / machine-readable report に分け、生成 script と workflow が path / format を所有する。
- coverage report を有効にした job は test failure を隠さず、artifact upload failure と品質 failure を区別する。
- retry を許す runner は、最終結果に加えて test ID、最初の失敗、attempt 数を PR summary へ出し、再現に必要な trace / log を artifact にする。retry-pass は green のまま flake として集計可能にする。
- developer wait report を導入する場合は、merge-ready、最初の failed step、cancel、再実行、欠測を区別し、集計ロジックを workflow と同じ変更で検証する。
- Processing Worker に coverage artifact を導入する場合も、実 service / process gate を coverage へ置き換えない。
- provider resource、費用、実測 memory / timing、非公開 OCR dataset は public artifact にせず private release evidence へ置く。

coverage baseline、developer wait budget、長期推移保存は、観測データ、計測可能性、維持コストを確認して個別に導入する。将来案を現行 gate として記述しない。
