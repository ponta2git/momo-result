# テストアーキテクチャ

目的: test size、coverage の運用、cross-system 契約、CI artifact の責務を定義する。日々の test 選択と oracle は `docs/test-rule.md`、command と変更 gate は `docs/dev-rule.md`、現在値は test / coverage 設定と CI workflow を正本とする。

## 1. Test Size

| Size | 境界 | 主な用途 |
| --- | --- | --- |
| S | process 内、外部 I/O なし | pure function、domain、parser、codec、ViewModel |
| M | process 内の組み合わせ、制御した double | HTTP app、usecase、component、MSW、in-memory adapter |
| L | 実 service、native dependency、別 process | PostgreSQL、Redis、object storage、OCR、worker process |
| XL | runtime image、browser、複数 process、resource 計測 | runtime smoke、Playwright、preemption、release resource gate |

size は実行時間ではなく、失敗時に疑う境界と依存範囲で決める。下位 size は分岐を詳しく、上位 size は接続と代表経路を検証し、近い test の成功を変更経路の証拠にしない。

## 2. Coverage Model

coverage は次の2モードを分ける。

| Mode | 目的 | 失敗条件 |
| --- | --- | --- |
| gate | 明示した threshold の維持 | test または threshold 違反 |
| report | PR review と推移確認 | test failure。coverage 値は非 blocking |

- CI は同じ test 集合を通常実行と coverage 実行で二重に回さない。report を作る場合は通常 test を coverage 付き実行へ置き換える。
- production deploy は coverage artifact の生成を待たず、同じ test 集合と変更対象の integration / smoke を release gate にする。
- threshold、対象 file、除外、丸め、report path は tool 設定と生成 script を正本とし、この文書へ値を写さない。
- aggregate coverage は重要経路の証拠にしない。重要 module は file / glob threshold、decision table、property / contract test のいずれかで固定する。
- external adapter、process isolation、resource、OCR accuracy は coverage 率ではなく専用の contract / smoke / dataset で評価する。

## 3. Subsystem Strategy

| 領域 | coverage が主に扱う範囲 | coverage 外で必須の oracle |
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
| runtime -> user / operator | image smoke、health / readiness、主要 E2E、resource / isolation |

契約 fixture は producer と consumer の両 validator を通す。同じ意味を各言語の手書き fixture へ複製せず、共有 schema / canonical fixture を使う。どの contract test が必要かは各専門正本を参照する。

## 5. CI Artifacts

- coverage artifact は PR review と推移確認の補助であり、integration / smoke の代わりにしない。
- artifact は raw summary、review 用 summary、必要な HTML / machine-readable report に分け、生成 script と workflow が path / format を所有する。
- coverage report を有効にした job は test failure を隠さず、artifact upload failure と品質 failure を区別する。
- Processing Worker に coverage artifact を導入する場合も、実 service / process gate を coverage へ置き換えない。
- provider resource、費用、実測 memory / timing、非公開 OCR dataset は public artifact にせず private release evidence へ置く。

baseline の hard gate 化、重要 file の non-regression、長期推移保存は、観測データと維持コストを確認して個別に導入する。将来案を現行 gate として記述しない。
