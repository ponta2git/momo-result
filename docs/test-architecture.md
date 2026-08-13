# テストアーキテクチャ

目的: サブシステムごとのテストサイズ、coverage 管理、CI成果物を一枚で確認できるようにする。

読む条件:

- テスト方針、coverage閾値、CI quality gate を変更する。
- どの層・どのサイズのテストを追加するか判断する。
- coverage report / artifact / 推移管理を確認する。

参照:

- テスト選択とoracle: `docs/test-rule.md`
- 検証コマンド: `docs/dev-rule.md`
- DB契約: `docs/db-rule.md`
- Redis/OCR queue契約: `docs/redis-streams-ocr-contract.md`
- 戦績分析job / 成果物契約: `docs/requirements/series-analysis-batch.md`

## 1. Test Size

| Size | 境界 | 主な対象 | CIでの扱い |
|---|---|---|---|
| S | プロセス内、外部I/Oなし | pure function、domain、parser、codec、view model | 通常PRで常時 |
| M | プロセス内または軽量境界、test doubleあり | HTTP app、usecase、web component/page、MSW、in-memory adapter | 通常PRで常時 |
| L | 外部runtimeまたは実processあり | PostgreSQL、Redis、native OCR、分析子process、Testcontainers | 関連PRとCI quality gate |
| XL | runtime image / browser / 複数process / resource計測 | runtime smoke、Playwright E2E、分析worker連続実行、deploy前確認 | deploy workflow / main / 重要PR |

サイズは実行時間ではなく、失敗時に疑う境界と依存範囲で決める。近いサイズの成功を、変更した経路そのものの検証として代用しない。

## 2. Coverage Model

coverage は二つのモードを分ける。

| モード | 目的 | 失敗扱い |
|---|---|---|
| gate mode | ローカルまたは明示実行で閾値を守る | 設定ファイルの閾値で失敗 |
| report mode | CI artifact と job summary を残す | テスト失敗は失敗。coverage閾値は report-only 設定で非ブロック |

CI の report mode は、同じテスト集合を通常実行と coverage 実行で二重に回さない。`report_coverage` が有効な workflow では、通常テスト step を coverage 付きテスト step に置き換える。`report_coverage` が無効な production deploy 経路では、通常テストだけを release gate とし、coverage artifact 生成を待たない。

閾値の正本:

| 領域 | 正本 | 現在の要点 |
|---|---|---|
| web | `apps/web/vite.config.ts` | statements / lines / functions は80%、branches は75%。`COVERAGE_REPORT_ONLY=1` では閾値を外す。`.tsx` と生成型は集計対象外。 |
| api | `apps/api/build.sbt` | statements 80%、branches 70%。CI report mode の `apiTestWithCoverageReportOnly` は `coverageFailOnMinimum := false`。PostgreSQL / Redis adapter は coverage率でなくintegration contractで保証。 |
| analysis / OCR worker | fixture / property / state-machine testと実service smoke | 現時点はcoverage率をgateにせず、pure calculation・OCR characterizationの決定論的oracleと、DB / Redis / R2 / Linux process contractで保証する。 |

丸めルール:

- raw coverage は小数1桁で `raw-summary.json` に保存する。
- baseline候補値は 5% 刻みで切り捨てる。
- `99.5%` 以上だけ `100%` 候補に丸める。
- 重要ファイルに明示した `95%` / `100%` threshold は、丸めず契約として維持する。
- 初回CIの fresh report を正とし、古いローカル report は参考値に留める。

## 3. apps/web

| 対象範囲 | 主テストサイズ | 確保するcoverage / oracle |
|---|---|---|
| `src/app` | S / M | router、redirect、layout shell の代表分岐。URLと可視状態をassertする。 |
| `src/shared/api` | S / M | API wrapper、Problem Details、query key、cache helper。重要ファイルはfile別thresholdで固定する。 |
| `src/shared/auth`, `src/shared/lib`, `src/shared/domain` | S | pure logic とブラウザ境界。分岐の独立因子をtable化する。 |
| `src/features/*/*ViewModel`, request transform, Zod schema | S | mode discriminator、optional field、payload shape を decision table で固定する。 |
| `src/features/**/*.tsx` page/component | M | line coverageより scenario coverage を優先する。loading / error / success / mutation / cache反映を検証する。 |
| `e2e/app-smoke.spec.ts` | XL | 開催作成、OCR開始、レビュー確定、一覧、詳細、export、master管理、戦績分析状態と管理操作を狭く通す。 |

現行 coverage 設定は `apps/web/vite.config.ts` を正とする。全体の statements / lines / functions を80%、branchesを75%で判定し、`.tsx` は集計対象外にする。UIは scenario coverage と Playwright smoke で管理する。

## 4. apps/api

| 対象範囲 | 主テストサイズ | 確保するcoverage / oracle |
|---|---|---|
| `domain` | S | 不変条件、lifecycle、policy。複合条件はtable-driven testで固定する。 |
| `usecases` | S / M | 状態遷移、validation、副作用境界。DTO、DB row intent、queue payloadをassertする。 |
| `endpoints`, `codec` | S / M | request / response roundtrip、OpenAPI、Problem Details。 |
| `http` | M | auth、CSRF、routing、error mapping。HTTP app起動は境界確認に限定する。 |
| in-memory `adapters` / repository contract | S / M | 本番adapterと共有する意味論を契約テストで固定する。 |
| `adapters/postgres` | L | scoverage対象外でよい。SQL、transaction、DB contract、FK順序を実PostgreSQLで検証する。 |
| Redis producer / outbox | M / L | JSON Schema、payload contract、Redis wire ack / claim / retry を検証する。 |
| 戦績分析job / artifact repository | M / L | mutationとintentのtransaction、lease、coalescing、version、原子的成果物公開を検証する。 |

現行 coverage 設定は `apps/api/build.sbt` を正とする。PostgreSQL / Redis adapter は coverage率ではなく、`apiDbQuality` / `apiRedisQuality` の contract 成功で保証する。

## 5. apps/analysis-worker

| 対象範囲 | 主テストサイズ | 確保するcoverage / oracle |
|---|---|---|
| OCR queue / control | S / M / L | v2 payload、job lifecycle、lease / fence、ack / PEL / DLQ、failure code。複合条件はtable-driven。 |
| OCR parser / image processing | S / L | 画面種別、金額・順位・事件回数・名前寄せ、FullHD / media検証、native OCR adapter。 |
| OCR object storage | M / L | opaque key、bytes / checksum / media type再検証、R2 get、失敗時のterminal化。 |
| OCR accuracy evaluator | 別枠 | code coverageではなく、version固定datasetの項目別正答率、差分、処理時間を非公開artifactで管理する。独立blind holdoutは必須gateにせず、このoracleから未知画像への一般化保証を導かない。 |
| pure calculation / statistics | S | 数式、分母、同値、丸め、seed、入力順独立性、品質状態。golden、高精度参照値、propertyを使う。 |
| scope / artifact assembly | S / M | 全有効スコープ、計算再利用、安定した並び順、schema / algorithm version、部分成果物禁止。 |
| job state machine | S / M | queued / running / terminal、最大3回のtransient retry、timeout非retry、coalescing、preemption。 |
| PostgreSQL / Redis adapters | L | lease、outbox、publish、pending / claim / ack、冪等性、terminal write before ackを実サービスで検証する。 |
| parent / child process | L | 正常終了、異常終了、hard timeout、signal、zombie防止、atomic publish。 |
| release resource gate | XL / 別枠 | 固定4名、全scope、現在の2倍かつ最低500試合、100回連続実行のpeak memoryと処理時間。provider実測はprivateに保存する。 |
| public runtime JVM resource gate | XL | 実効JVM flag、cgroup hard limit、runtime smoke、Playwright E2E、最大HTTP同時数の負荷、OOM eventなし、25%以上のpeak memory余白を同じimageで検証する。 |

OCR精度劣化はcode coverageでは検知しにくいため、characterizationとaccuracy reportを別枠で扱う。
戦績分析のRust移植では現行Scalaとの差分を記録するが、Scala値だけを正しさのoracleにしない。より正確な差異は
高精度参照値、要求から導いたgolden、または性質テストで証明し、algorithm versionを更新する。

## 6. Cross-System

| 契約 | 主テストサイズ | 管理方法 |
|---|---|---|
| API -> web OpenAPI / generated types | M | `apiOpenApiCheck`、`generate:api`、生成差分ゼロ。 |
| API -> OCR worker Redis queue payload | M / L | v2 JSON Schema、Scala/Rust contract tests、Redis wire integration。 |
| API -> analysis worker job / queue | M / L | DB consumer contract、Scala/Rust contract tests、Redis wire integration。 |
| analysis worker -> API / web artifact | M / L | artifact schema fixture、version不一致拒否、同一version読取、API内分析なし。 |
| DB consumer contract | L | `DbContractSpec`、repository integration、momo-db migration適用済みTestcontainers。 |
| runtime images | XL | nginx設定、実行ファイル、healthz / worker heartbeat、cache header、origin lock、container logs。 |
| logged-in UX | XL | Playwright E2E smoke。coverage率ではなく経路リストで管理する。 |

## 7. CI Artifacts

coverage report はPRを落とす主目的ではなく、推移確認とレビュー補助のために保存する。

| Workflow | Report command | Artifact |
|---|---|---|
| web | `pnpm --filter web test:coverage:report` | `apps/web/coverage/`, `coverage-summary/web/` |
| API | CI: `sbt apiTestWithCoverageReportOnly`; local standalone: `sbt apiCoverageReportOnly` | `scoverage-report/`, `coverage-report/`, `coverage-summary/api/` |
| analysis / OCR worker | coverage artifact未設定。通常testと実service smokeをrelease gateにする | なし |

`scripts/ci/write-coverage-summary.py` が raw 値と丸め候補値を正規化し、次を生成する。

- `raw-summary.json`
- `rounded-baseline.json`
- `summary.md`

resource class、費用、実測memory / timingは公開CI artifactへ含めず、privateのrelease evidenceへ保存する。

## 8. Later Phases

別PRで判断する項目:

1. report mode の baseline を hard gate へ昇格する。
2. 重要ファイル / 重要glob の non-regression gate を追加する。
3. 既定ブランチのcoverage推移を長期保存する。
