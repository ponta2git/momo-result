# 開発作業規約

目的: ローカル起動、検証コマンド、変更 gate、Git 運用を判断する。version と script の現在値は package manifest、toolchain 設定、CI workflow を正本とする。

何を証明するかは `docs/test-rule.md`、DB は `docs/db-rule.md`、分析 runtime の横断要求は `docs/requirements/series-analysis-batch.md` を参照する。

## 1. Environment

- local secret は追跡外の env file、production / CI secret は各 secret store で管理する。必要な名前だけを `.env.example` に置く。
- API / worker が root env を自動で読むと仮定しない。起動する process に必要最小限の変数だけを渡す。
- worker container へ OAuth など無関係な secret を渡さず、接続値を docs、tracked file、shell history へ書かない。
- DB を使う前に sibling `momo-db` の migration が接続先へ適用済みであることを確認する。
- integration / E2E は普段使いの DB、Redis、bucket と分離する。外部依存 gate の未実行は、その wire 動作を未検証として報告する。

## 2. Local Run

通常の API + Web は root の `pnpm dev` を使う。依存 DB の起動と migration は `../momo-db` の scripts を使い、利用可能な command は各 `package.json` を正とする。

`pnpm dev` は Processing Worker を起動しない。worker の process isolation は Linux runtime が前提なので、macOS で host binary を直接実行せず、`apps/processing-worker/Dockerfile` から build した専用 container を使う。

- worker には専用 env file と明示的な memory / cgroup 設定を渡す。root env 全体を渡さない。
- runtime image、DB / Redis control plane、preemption は `scripts/ci/` の対応 smoke と同じ境界で検証する。
- algorithm version の昇格は image 更新と別操作とし、reader / worker compatibility を確認してから dry-run、apply の順で行う。DB row を直接書き換えない。
- local volume のデータが消えたように見えても書込みや volume 削除を続けず、mount と PostgreSQL major version を確認する。異なる major version の data directory を直接 mount しない。
- Playwright の既定 E2E は隔離環境を使う。既存 runtime を対象にする場合は runtime 用 script、任意 target は target 用 script を使い、接続先 data store の隔離を確認する。

## 3. Commands

日常 command は root / app の package manifest と build 設定から選ぶ。代表的な品質 command だけを示す。

| 領域 | 品質 command |
| --- | --- |
| Web | `pnpm --filter web format:check`、`lint`、`typecheck`、`test:run`、必要に応じ `build` / `e2e` |
| API | `sbt apiQuality`、`sbt test`、必要に応じ `apiCoverage` / `apiDbQuality` / `apiRedisQuality` / `apiR2Quality` |
| Processing Worker | `cargo fmt --all -- --check`、`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`、`cargo test --locked --workspace --all-targets --all-features`、release build |
| Go tools | `cd tools && go test ./... && go vet ./...` |
| Workflow | `pnpm actionlint` |
| Public docs / config | `pnpm public:safety:check` |

生成 OpenAPI / Web 型、coverage threshold、lint 設定、smoke の引数は、それぞれ生成 script、build 設定、`scripts/ci/` を正本とする。文書中の command が実装とずれた場合は実装を直すか、この表を更新し、別名 command を増やさない。

## 4. Change Gates

| 変更 | 必須 gate |
| --- | --- |
| Web production | format、lint、typecheck、unit / component test |
| Web API contract | Web gate + OpenAPI / API 型生成 |
| Web build / runtime | Web gate + build |
| ログイン後の主要 UI flow | Web gate + Playwright |
| API endpoint / usecase / domain / codec | API quality + unit test、対象なら coverage |
| PostgreSQL repository / DB 前提 | API gate + DB quality |
| Redis / OCR queue | API gate + Redis quality + queue 契約の required tests |
| R2 image storage | API / DB gate + R2 quality + reconciler readiness |
| Processing Worker production | format、Clippy、全 target / feature test、release build |
| analysis algorithm version | Worker gate + release DB / control-plane compatibility |
| worker DB / Redis / process / isolation | Worker gate +対象 control-plane、preemption、image smoke |
| runtime / deploy config | public safety、image build / scan、runtime / memory / shutdown smoke、runtime Playwright |
| Go deploy / ops tool | Go test / vet、shell collector を変えた場合は対応 script test |
| docs only | `git diff --check`、`pnpm public:safety:check` |

選択基準と oracle は `docs/test-rule.md`、現在の gate 構成は CI workflow を正本とする。変更分類を弱めて gate を避けない。

## 5. CI Gates / Release

- CI は変更範囲を fail closed で分類し、対象 subsystem の gate を通す。workflow、service、timeout、artifact path の一覧は docs へ写さない。
- release 候補は一度だけ build し、commit、設定、immutable artifact identity、digest、producer attempt を記録する。後続 smoke / deploy / rollback は同じ候補を使う。
- 外部 action / provider の値は境界で検証・正規化し、consumer 用の表現を推測しない。workflow 再実行時も current attempt から候補 identity を再計算しない。
- mutable tag や cache hit を provenance / 検証成功の根拠にしない。
- analysis candidate 作成と production 昇格、backfill、audit は別操作とする。人間向け手順は `private/ops/runbook.md` を正本とする。
- 公開 edge、内部 health、機能応答、resource / performance は別の観測点・証拠として扱う。gate のために security policy を弱めない。
- 共有 credential の rotation は、更新前に全 consumer と secret store を列挙し、同じ保守単位で更新する。各 consumer が更新後の credential で新規接続し、必要な runtime peer が ready になった証拠を揃えるまで完了としない。

## 6. Production rollback verification

- rollback 対象は immutable provenance を再検証できる成功済み候補に限る。来歴を推測で復元しない。
- 通常 deploy と同じ排他・承認・validator 境界を使い、target 世代で必須だった core check を確認する。
- 変更対象の UI、API、usecase、engine を列挙し、差分と回帰 test が全実行経路を覆うことを確認する。
- deploy 成功、health、機能応答、性能回復を別々に判定する。観測不能な項目は未検証と報告する。

## 7. Git

branch / commit の形式は `<type>/<short-description>` / `<type>: <概要>` とし、type は `feat`、`fix`、`refactor`、`test`、`docs`、`chore` から選ぶ。PR は変更理由と gate が一つの単位で確認できる大きさに保ち、squash merge を基本とする。
