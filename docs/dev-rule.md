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

OpenAPI / Web 型の生成関係は `docs/architecture.md` の Wire Boundary、coverage の運用は `docs/test-architecture.md` を正本とする。実行 command、lint 設定、smoke の引数は生成 script、build 設定、`scripts/ci/` を実行上の正本とする。文書中の command が実装とずれた場合は実装を直すか、この表を更新し、別名 command を増やさない。

## 4. Change Gates

各 check は次のいずれか一つの役割を持つ。複数の目的を暗黙に背負わせず、結果の意味を PR 上で区別する。

| 役割 | blocking | 判定対象 |
| --- | --- | --- |
| Product-value evidence | Yes | 利用者の結果、data 保全、利用者へ到達する共通実装契約 |
| Pipeline-integrity evidence | Yes | compile、生成 freshness、schema / dependency 整合、artifact provenance、workflow 自体の成立 |
| Diagnostic report | No | aggregate coverage、flake、module size、developer wait、長期推移 |
| Manual review | Yes（選択時） | 視覚階層、関係的余白、文章の強さなど自動 oracle が不適切な項目 |

- blocking check は、所有する正本、検出する違反、失敗時の対処を特定できる場合だけ置く。pipeline-integrity evidence の成功を product behavior の成功として扱わない。
- manual review は、利用者影響があり自動 oracle が適切でない場合だけ選び、確認対象と結果を PR に残す。近似的な checker を追加して代用しない。
- lint / checker は syntax-aware な既存 tool と設定を優先する。独自 script は、既存 tool で表現できず、利用者価値または pipeline integrity への影響が大きく、positive / negative fixture で誤検出と未検出を管理できる場合だけ採用する。
- check が速いことは採用・維持の理由にしない。廃止時も同等 check の機械的な追加を要求せず、守っていた価値と証拠を `docs/test-rule.md` の基準で再評価する。
- 一つの command に複数 check をまとめても各結果の役割を区別する。Diagnostic report の欠測や閾値超過を blocking command の失敗へ畳み込まない。

| 変更 | 必須 gate |
| --- | --- |
| Web production | format、lint、typecheck + 選択した unit / component evidence |
| Web API contract | Web gate + Tapir 由来 OpenAPI の生成・構造 lint・freshness + Web 型生成 / typecheck |
| Web build / runtime | Web gate + build |
| login、試合記録、OCR、比較、export の主要 UI flow | Web gate + 影響する利用者契約の Playwright |
| API endpoint / usecase / domain / codec | API quality + 選択した unit / contract evidence |
| PostgreSQL repository / DB 前提 | API gate + 変更経路の DB quality |
| Redis / OCR queue | API gate + 変更経路の Redis quality / queue contract |
| R2 image storage | API / DB gate + 変更経路の R2 quality / reconciler readiness |
| Processing Worker production | format、Clippy、release build + 選択した target / feature evidence |
| analysis algorithm version | Worker gate + release DB / control-plane compatibility |
| worker DB / Redis / process / isolation | Worker gate + 対象 control-plane、preemption、image smoke |
| runtime / deploy config | public safety、image build / scan + 変更経路の runtime / memory / shutdown / Playwright evidence |
| Go deploy / ops tool | Go test / vet、shell collector を変えた場合は対応 script test |
| docs only | `git diff --check`、`pnpm public:safety:check` |

表は変更時に選ぶ evidence の種類を示し、新しい test case の自動追加や各層での重複を要求しない。選択基準と oracle は `docs/test-rule.md`、現在の job 構成とまとめて実行する suite は CI workflow を実行上の正本とする。変更分類を弱めて gate を避けない。

## 5. Developer Wait / Parallel Execution

- 品質を保つ範囲で developer 待ち時間を最小化する。独立した job は並列実行し、同じ test 集合の通常実行と coverage 実行、重複 setup、不要な build を critical path に重ねない。test 内の並列性と隔離は `docs/test-architecture.md` に従う。
- shared service、順序、resource 競合など直列性が意味を持つ gate だけを直列化し、理由と scope を workflow 設定の近くへ残す。
- merge-ready duration は workflow / job timestamp から非 blocking に集計できる。first actionable failure は最初の failed step を暫定 proxy とし、flake、setup、provider failure、cancel、再実行を区別できるか評価してから導入する。
- 数値予算は必須としない。設定する場合は代表期間の推計と変動幅を根拠にし、計測定義と同じ変更で導入する。local は代表環境で推計し、個人 telemetry を収集しない。

## 6. CI Gates / Release

- CI は変更範囲を fail closed で分類し、対象 subsystem の gate を通す。workflow、service、timeout、artifact path の一覧は docs へ写さない。
- PR では compile / lint / generation などの pipeline integrity、選択した S / M evidence、変更境界に応じた DB / Redis contract、影響する主要 user flow を優先する。endurance、resource limit、live provider は、PR でしか検出できない変更を除き release evidence へ分離する。
- retry の結果分類と report artifact は `docs/test-architecture.md` の CI Artifacts に従う。
- release 候補は一度だけ build し、commit、設定、immutable artifact identity、digest、producer attempt を記録する。後続 smoke / deploy / rollback は同じ候補を使う。
- 外部 action / provider の値は境界で検証・正規化し、consumer 用の表現を推測しない。workflow 再実行時も current attempt から候補 identity を再計算しない。
- mutable tag や cache hit を provenance / 検証成功の根拠にしない。
- analysis candidate 作成と production 昇格、backfill、audit は別操作とする。人間の承認、復旧判断、操作順は `private/ops/runbook.md` を正本とし、public な test contract へ複製しない。
- 公開 edge、内部 health、機能応答、resource / performance は別の観測点・証拠として扱う。gate のために security policy を弱めない。
- 共有 credential の rotation は、更新前に全 consumer と secret store を列挙し、同じ保守単位で更新する。各 consumer が更新後の credential で新規接続し、必要な runtime peer が ready になった証拠を揃えるまで完了としない。

## 7. Production rollback verification

- rollback 対象は immutable provenance を再検証できる成功済み候補に限る。来歴を推測で復元しない。
- 通常 deploy と同じ排他・承認・validator 境界を使い、target 世代で必須だった core check を確認する。
- 変更対象の UI、API、usecase、engine と、利用者影響のある production 経路を列挙し、選択した回帰 evidence がその経路を直接通すことを確認する。対象外の経路は確認済みと扱わない。
- deploy 成功、health、機能応答、性能回復を別々に判定する。観測不能な項目は未検証と報告する。

## 8. Git

branch / commit の形式は `<type>/<short-description>` / `<type>: <概要>` とし、type は `feat`、`fix`、`refactor`、`test`、`docs`、`chore` から選ぶ。PR は変更理由と gate が一つの単位で確認できる大きさに保ち、squash merge を基本とする。
