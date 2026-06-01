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

## 1. Test Size

| Size | 境界 | 主な対象 | CIでの扱い |
|---|---|---|---|
| S | プロセス内、外部I/Oなし | pure function、domain、parser、codec、view model | 通常PRで常時 |
| M | プロセス内または軽量境界、test doubleあり | HTTP app、usecase、web component/page、MSW、in-memory adapter | 通常PRで常時 |
| L | 外部runtimeあり | PostgreSQL、Redis、native OCR、Testcontainers | 関連PRとCI quality gate |
| XL | runtime image / browser / 複数プロセス | runtime smoke、Playwright E2E、deploy前確認 | deploy workflow / main / 重要PR |

サイズは実行時間ではなく、失敗時に疑う境界と依存範囲で決める。近いサイズの成功を、変更した経路そのものの検証として代用しない。

## 2. Coverage Model

coverage は二つのモードを分ける。

| モード | 目的 | 失敗扱い |
|---|---|---|
| gate mode | ローカルまたは明示実行で閾値を守る | 設定ファイルの閾値で失敗 |
| report mode | CI artifact と job summary を残す | workflow 側で `continue-on-error`、または report-only 設定で非ブロック |

閾値の正本:

| 領域 | 正本 | 現在の要点 |
|---|---|---|
| web | `apps/web/vite.config.ts` | global threshold と重要ファイル別 threshold。`COVERAGE_REPORT_ONLY=1` では閾値を外す。`.tsx` と生成型は集計対象外。 |
| api | `apps/api/build.sbt` | statement / branch threshold。`apiCoverageReportOnly` は `coverageFailOnMinimum := false`。PostgreSQL / Redis adapter は coverage率でなくintegration contractで保証。 |
| ocr-worker | `apps/ocr-worker/pyproject.toml` | branch coverage 有効、`fail_under` あり。CI report command は `--cov-fail-under=0` でartifact生成を優先。 |

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
| `e2e/app-smoke.spec.ts` | XL | 開催作成、OCR開始、レビュー確定、一覧、詳細、export、master管理を狭く通す。 |

現行 coverage 設定は `apps/web/vite.config.ts` を正とする。`.tsx` は集計対象外にし、UIは scenario coverage と Playwright smoke で管理する。

## 4. apps/api

| 対象範囲 | 主テストサイズ | 確保するcoverage / oracle |
|---|---|---|
| `domain` | S | 不変条件、lifecycle、policy。複合条件はtable-driven testで固定する。 |
| `usecases` | S / M | 状態遷移、validation、副作用境界。DTO、DB row intent、queue payloadをassertする。 |
| `endpoints`, `codec` | S / M | request / response roundtrip、OpenAPI、Problem Details。 |
| `http` | M | auth、CSRF、routing、error mapping。HTTP app起動は境界確認に限定する。 |
| in-memory `adapters` / repository contract | S / M | 本番adapterと共有する意味論を契約テストで固定する。 |
| `repositories/postgres` | L | scoverage対象外でよい。SQL、transaction、DB contract、FK順序を実PostgreSQLで検証する。 |
| Redis producer / outbox | M / L | JSON Schema、payload contract、Redis wire ack / claim / retry を検証する。 |

現行 coverage 設定は `apps/api/build.sbt` を正とする。PostgreSQL / Redis adapter は coverage率ではなく、`apiDbQuality` / `apiRedisQuality` の contract 成功で保証する。

## 5. apps/ocr-worker

| 対象範囲 | 主テストサイズ | 確保するcoverage / oracle |
|---|---|---|
| `features/ocr_jobs` | S / M / L | job lifecycle、payload validation、ack / pending / DLQ、failure code。複合条件は table-driven。 |
| `features/screen_detection`, `features/player_order` | S | screen type、色順、fallback条件。branch を重視する。 |
| parser系 `total_assets`, `revenue`, `incident_log`, `ocr_results` | S | 金額、順位、事件回数、名前寄せ、警告。外部契約 payload をassertする。 |
| `features/image_processing`, `temp_images`, `text_recognition` | S / L | 画像メタデータ、サイズ制限、native OCR adapter smoke。 |
| `app` | M | config、composition、worker process。process境界は代表経路に絞る。 |
| accuracy evaluator | 別枠 | code coverageではなく、holdout正答率、差分、処理時間をartifactで管理する。 |

現行 coverage 設定は `apps/ocr-worker/pyproject.toml` を正とする。OCR精度劣化は code coverage では検知しにくいため、accuracy report のartifact化は別枠で扱う。

## 6. Cross-System

| 契約 | 主テストサイズ | 管理方法 |
|---|---|---|
| API -> web OpenAPI / generated types | M | `apiOpenApiCheck`、`generate:api`、生成差分ゼロ。 |
| API -> worker Redis queue payload | M / L | JSON Schema、Scala/Python contract tests、Redis wire integration。 |
| DB consumer contract | L | `DbContractSpec`、repository integration、momo-db migration適用済みTestcontainers。 |
| runtime image | XL | nginx設定、実行ファイル、healthz、cache header、origin lock、container logs。 |
| logged-in UX | XL | Playwright E2E smoke。coverage率ではなく経路リストで管理する。 |

## 7. CI Artifacts

coverage report はPRを落とす主目的ではなく、推移確認とレビュー補助のために保存する。

| Workflow | Report command | Artifact |
|---|---|---|
| web | `pnpm --filter web test:coverage:report` | `apps/web/coverage/`, `coverage-summary/web/` |
| API | `sbt apiCoverageReportOnly` | `scoverage-report/`, `coverage-report/`, `coverage-summary/api/` |
| OCR worker | `uv run pytest --cov=momo_ocr ... --cov-fail-under=0` | `coverage.xml`, `coverage.json`, `htmlcov/`, `coverage-summary/ocr-worker/` |

`scripts/ci/write-coverage-summary.py` が raw 値と丸め候補値を正規化し、次を生成する。

- `raw-summary.json`
- `rounded-baseline.json`
- `summary.md`

## 8. Later Phases

別PRで判断する項目:

1. report mode の baseline を hard gate へ昇格する。
2. 重要ファイル / 重要glob の non-regression gate を追加する。
3. OCR holdout accuracy report を nightly / release gate にする。
4. main branch の coverage推移を長期保存する。
