# 開発作業規約

目的: ローカル起動、検証コマンド、変更 gate、Git 運用を判断する。version と script の現在値は package manifest、toolchain 設定、CI workflow を正本とする。

何を証明するかは `docs/test-rule.md`、DB は `docs/db-rule.md`、分析 runtime の横断要求は `docs/requirements/series-analysis-batch.md` を参照する。

## 1. Environment

- local secret は追跡外の env file、production / CI secret は各 secret store で管理する。必要な名前だけを `.env.example` に置く。
- API / worker が root env を自動で読むと仮定しない。起動する process に必要最小限の変数だけを渡す。
- worker container へ OAuth など無関係な secret を渡さず、接続値を docs、tracked file、shell history へ書かない。
- DB を使う前に sibling `momo-db` の migration が接続先へ適用済みであることを確認する。
- 隔離testの既定migration選択は共通resolverで `.momo-db-ref` の内容と照合し、異なるcheckoutや未追跡SQLを拒否する。固定revisionのarchiveや意図したschema実験は `MOMO_DB_MIGRATIONS_DIR` で明示し、検証した前提を区別する。
- integration / E2E は普段使いの DB、Redis、bucket と分離する。外部依存 gate の未実行は、その wire 動作を未検証として報告する。
- Web / runtime E2Eのfresh DB bootstrapは `web-e2e` profileで現行の分析公開契約を初期化する。migrationだけのbaselineと区別し、既存DBの正式なpromotionや本番切替を代用しない。

上記の隔離と接続先を確認できるローカル検証は、依頼された変更の検証・失敗修正・影響範囲の再実行まで個別承認なしで進める。任意 target や live provider を使う command にはこの前提を持ち込まず、実際の接続先と副作用を確認する。

## 2. Local Run

通常の API + Web は root の `pnpm dev` を使う。起動 tool は `apps/web/scripts/dev-local.mts` を Node で直接実行する。Node の version は `mise.toml` を正とする。依存 DB の起動と migration は `../momo-db` の scripts を使い、利用可能な command は各 `package.json` を正とする。

`pnpm dev` は Processing Worker を起動しない。worker の process isolation は Linux runtime が前提なので、macOS で host binary を直接実行せず、`apps/processing-worker/Dockerfile` から build した専用 container を使う。

- worker には専用 env file と明示的な memory / cgroup 設定を渡す。root env 全体を渡さない。
- runtime image は `scripts/ci/`、DB control plane と preemption は `scripts/e2e/` の対応 smoke と同じ境界で検証する。
- algorithm version の昇格は image 更新と別操作とし、reader / worker compatibility を確認してから dry-run、apply の順で行う。DB row を直接書き換えない。
- local volume のデータが消えたように見えても書込みや volume 削除を続けず、mount と PostgreSQL major version を確認する。異なる major version の data directory を直接 mount しない。
- システム E2E は毎回新しい隔離環境を作り、終了・失敗・中断時に所有資源を回収する。任意の既存 DB や runtime を対象にしない。

E2E の実行には Node、Docker、JDK / sbt と、`.momo-db-ref` / `.summit-ref` に固定した checkout が必要。既定の配置は `_deps/momo-db` / `_deps/summit`。各 checkout の package manager で依存を install・build し、DB の開発規約に従って準備する。migration は runner が新しい DB に適用する。

Runtime と Worker の production image、回復・通知契約用の Worker `e2e-test` target を build し、`MOMO_E2E_RUNTIME_IMAGE`、`MOMO_E2E_WORKER_IMAGE`、`MOMO_E2E_CONTROLLED_WORKER_IMAGE` に指定する。runner は開始時に immutable image ID を確定する。

- `pnpm web:e2e:ui`：ビルド済み Web と明示した HTTP 応答だけでブラウザ操作を検証する。
- `pnpm e2e`：実 Runtime / Worker を通す保存・OCR・分析・通知・権限と、記録操作の回復を検証する。
- `pnpm e2e:recovery`：制御 Worker を使う OCR の回復と、ブラウザを使わない通知結合契約を実行する。
- `pnpm test:notification-contract`：独立 DB で分析通知 producer と固定 Summit consumer の上限・描画互換性を検証する。

手動の E2E 実確認は Playwright MCP を使う。`pnpm e2e --hold`（制御 Worker は `pnpm e2e:recovery --hold`）で同じ隔離環境を保持し、表示された private metadata の接続先と session fixture を使う。metadata、cookie、CSRF、環境ファイルは共有しない。対象ケースを実行したら runner を中断して回収する。CI は同じ runner と suite を実行する。

## 3. Commands

日常 command は root / app の package manifest と build 設定から選ぶ。代表的な品質 command だけを示す。

| 領域 | 品質 command |
| --- | --- |
| Web | `pnpm --filter web format:check`、`lint`、`contract:check`、`typecheck`、`test:run`、`scripts:check`、必要に応じ `build` / `e2e:ui` |
| API | `sbt --server --batch apiQuality`、`sbt --server --batch testFull`、同じオプションで必要に応じ `apiCoverage` / `apiDbQuality` / `apiRedisQuality` / `apiR2Quality` |
| Processing Worker | `cargo fmt --all -- --check`、`cargo clippy --locked --workspace --all-targets`、`cargo test --locked --workspace`、production image build |
| Go runtime / tools | 変更対象の `apps/runtime` または `scripts/tools` で `go test ./... && go vet ./...` |
| Workflow / policy scripts | `pnpm actionlint`、`pnpm test:policy` |
| Public docs / config | `pnpm public:safety:check` |

OpenAPI / Web 型の生成関係は `docs/architecture.md` の Wire Boundary、coverage の運用は `docs/test-architecture.md` を正本とする。実行 command、lint 設定、smoke の引数は生成 script、build 設定、`scripts/ci/`、`scripts/e2e/` を実行上の正本とする。文書中の command が実装とずれた場合は実装を直すか、この表を更新し、別名 command を増やさない。

## 4. Change Gates

必要な check を選び、その結果が何を示すかを次の役割で区別する。分類を埋めるために check や記録を増やさない。

| 役割 | blocking | 判定対象 |
| --- | --- | --- |
| Product-value evidence | Yes | 利用者の結果、data 保全、利用者へ到達する共通実装契約 |
| Pipeline-integrity evidence | Yes | compile、生成 freshness、schema / dependency 整合、artifact provenance、workflow 自体の成立 |
| Diagnostic report | No | aggregate coverage、flake、developer wait、長期推移 |
| Manual review | Yes（選択時） | 視覚階層、関係的余白、文章の強さなど自動 oracle が不適切な項目 |

- blocking check は、所有する正本、検出する違反、失敗時の対処を特定できる場合だけ置く。pipeline-integrity evidence の成功を product behavior の成功として扱わない。
- manual review は、利用者影響があり自動 oracle が適切でない場合に選ぶ。エージェントによるブラウザ実確認も含み、本番操作などの人間承認とは別である。確認対象、重要な所見、限界を変更報告や PR に短く残し、近似的な checker や採点で代用しない。人間による不定期の確認を、この gate の完了条件に加えない。
- lint / checker は syntax-aware な既存 tool と設定を優先する。独自 script は、既存 tool で表現できず、利用者価値または pipeline integrity への影響が大きく、positive / negative fixture で誤検出と未検出を管理できる場合だけ採用する。
- production build が source detection、tree-shaking、minification などで output を選別し、runtime が識別子を動的に組み立てる場合、canonical build は consumer が必要とする識別子が最終 artifact に残ることを直接検証する。source 定義、compile、unit test の成功を artifact 保持の代用にせず、build が参照する checker、manifest、fixture は host と container の全 build input に含める。
- check が速いことは採用・維持の理由にしない。廃止時も同等 check の機械的な追加を要求せず、守っていた価値と証拠を `docs/test-rule.md` の基準で再評価する。
- 一つの command に複数 check をまとめても、契約の検証と診断を区別する。Diagnostic report の欠測や閾値超過を blocking command の失敗へ畳み込まない。

| 変更 | 必須 gate |
| --- | --- |
| Web production | format、lint、typecheck + 選択した unit / component evidence |
| Web test のみ | format、lint、typecheck + 変更・統合後の対象 suite。E2E / runner を変える場合はその実行境界も検証 |
| Web API contract | Web gate + Tapir 由来 OpenAPI の生成・構造 lint・freshness + Web 型生成 / typecheck |
| Web build / runtime | Web gate + build |
| login、試合記録、OCR、比較、export の主要 UI flow | Web gate + 影響する利用者契約の Playwright |
| API endpoint / usecase / domain / codec | API quality + 選択した unit / contract evidence |
| PostgreSQL repository / DB 前提 | API gate + 変更経路の DB quality |
| Redis | API gate + 変更経路の Redis quality |
| OCR job / scheduler | API / Worker gate + 変更経路の DB / process contract |
| R2 image storage | API / DB gate + 変更経路の R2 quality / reconciler readiness |
| Processing Worker production | format、Clippy、production image build + 選択した target / feature evidence |
| analysis algorithm version | Worker gate + release DB / control-plane compatibility |
| worker DB / process / isolation | Worker gate + 対象 control-plane、preemption、image smoke |
| runtime / deploy config | public safety、image build / scan + 変更経路の runtime / memory / shutdown / Playwright evidence |
| Node 開発 / E2E tool | Web の format、lint、typecheck、scripts:check + 変更した起動・service 境界の検証 |
| Go runtime / 開発 / ops tool | 対象 module の Go test / vet、CI script を変えた場合は対応 script test |
| docs only | `git diff --check`、`pnpm public:safety:check` |

表は変更時に選ぶ evidence の種類を示し、新しい test case の自動追加や各層での重複を要求しない。規約・skill の指示、参照資料、表示名・説明・default prompt の変更は docs only とする。script、schema、実行設定や tool 依存・起動 policy も変える場合は、その実行境界の gate を加える。選択基準と oracle は `docs/test-rule.md`、現在の job 構成とまとめて実行する suite は CI workflow を実行上の正本とする。変更分類を弱めて gate を避けない。

変更範囲に必要な gate と選択した品質証拠を確認したら、検証を終了する。追加・再実行は、結果を無効にする変更、失敗、具体的な未解決事項が生じた場合に、その影響範囲で行う。
結果の再利用は、対象コード、依存する schema・設定・環境、観測した経路が今回の判断に適合する場合に限る。必須 gate の実行単位は CI の定義に従い、未実行を通過扱いにしない。

件数を報告する場合は、追加・削除した case 数と実行した既存 suite の総数を区別する。suite の件数を品質や新規回帰 test の必要性の根拠にしない。

## 5. Developer Wait / Parallel Execution

- 次の判断に必要な前提を確かめたら、独立した検索・読み取り・job はまとめて並列実行する。同じ test 集合の通常実行と coverage 実行、重複 setup、不要な build を重ねない。test 内の並列性と隔離は `docs/test-architecture.md` に従う。
- subagent は独立した調査、領域別の変更、別視点のレビューに使い、目的・対象・成果物を絞る。主担当は結果待ちの間に独立した作業を進め、統合時に差分と必要な検証を確認する。依存先の未確定な判断や同じ編集を複数 agent に重ねず、委任数や並列率を達成目標にしない。
- shared service、生成先、DB、CPU / memory などの競合と、結果の統合負担を含めて並列度を決める。並列化で実行が遅くなる、検証が不安定になる場合は減らす。workflow の直列化に固有の理由がある場合は設定の近くに残す。
- 待ち時間の測定は、遅い工程や改善の効果を判断する必要がある場合だけ加える。timestamp や最初の failed step は一側面の観測であり、作業効率全体を表さない。数値予算・常設 telemetry を導入する前に、不要な実行や依存関係を整理する。予算が必要なら代表条件と変動幅を示し、local の個人 telemetry は収集しない。

## 6. CI Gates / Release

- CI は変更範囲を fail closed で分類し、対象 subsystem の gate を通す。workflow、service、timeout、artifact path の一覧は docs へ写さない。
- チケット完了前には最終差分が影響する基本操作・回復経路を同じ suite で確認する。PR を経由しない `develop` マージ前は、最新 `develop` とのマージ予定結果を隔離 checkout で作り、そのコードから build した候補で基本操作一式と関連する回復・契約を通す。検証後に対象コードや候補が変わった場合は、無効になった範囲を再実行する。
- 手動結果にも対象 commit（未commit差分があればその範囲）、Runtime / Worker image ID、suite・ケース、成否と未確認事項を残す。結果のためだけの恒久的な記録帳は増やさず、チケット・PR・作業報告へ記載する。
- PR では compile / lint / generation などの pipeline integrity、選択した S / M evidence、変更境界に応じた DB / Redis contract、影響する主要 user flow を優先する。endurance、resource limit、live provider は、PR でしか検出できない変更を除き release evidence へ分離する。
- release PR は snapshot、branch policy、公開情報を検証する。アプリ・image の gate は通常 PR と exact `master` commit の本番候補で実行し、release PR で重複させない。最終 gate の失敗は merge 後に判明するが、必要な候補の検証がすべて成功するまで本番変更を開始しない。
- retry の結果分類と report artifact は `docs/test-architecture.md` の CI Artifacts に従う。
- release 候補は一度だけ build し、commit、設定、immutable artifact identity、digest、producer attempt を記録する。後続 smoke / deploy / rollback は同じ候補を使う。
- 外部 action / provider の値は境界で検証・正規化し、consumer 用の表現を推測しない。workflow 再実行時も current attempt から候補 identity を再計算しない。
- mutable tag や cache hit を provenance / 検証成功の根拠にしない。
- 通常 release は runtime と Processing Worker の検証済み候補を揃え、同じ承認・排他の中で適用する。分析成果物の非互換変更では、公開を止めて単一世代へ切り替え、再計算と監査を終えてから再開する。独立した worker candidate workflow は重ねない。Worker の image・設定・稼働状態が一致し、未適用の設定がない場合は再配備を省く。
- 分析昇格・初回 backfill は配備後の実世代と DB の状態から必要性を判定し、安全に適用できる場合は自動実行する。手動操作も同じ判定・適用・監査を使う。対象 snapshot と世代に結びついた operation を再利用し、実行中・失敗・不要・完了を区別する。自動復旧できない場合は workflow を未成功とし、理由と再開方法を記録する。人間の承認、復旧判断、通知の受信設定は `private/ops/runbook.md` を正本とする。
- 公開 edge、内部 health、機能応答、resource / performance は別の観測点・証拠として扱う。gate のために security policy を弱めない。
- 共有 credential の rotation は、更新前に全 consumer と secret store を列挙し、同じ保守単位で更新する。各 consumer が更新後の credential で新規接続し、必要な runtime peer が ready になった証拠を揃えるまで完了としない。
- runtime release は `release/*` から `master` への PR merge を境界とする。`master` push の runtime / worker deploy、post-deploy verification、必要な分析処理の完了確認がすべて成功した後、release PR の `## Release notes` を基に exact `master` commit の GitHub Release を発行する。追跡する changelog を別に手編集せず、GitHub Releases を公開 release 履歴の正本とする。

## 7. Production rollback verification

- rollback 対象は immutable provenance を再検証できる成功済み候補に限る。来歴を推測で復元しない。
- 通常 deploy と同じ排他・承認・validator 境界を使い、target 世代で必須だった core check を確認する。
- 変更対象の UI、API、usecase、engine と、利用者影響のある production 経路を列挙し、選択した回帰 evidence がその経路を直接通すことを確認する。対象外の経路は確認済みと扱わない。
- deploy 成功、health、機能応答、性能回復を別々に判定する。観測不能な項目は未検証と報告する。

## 8. Git

`develop` を default branch とし、通常の変更は `<type>/<short-description>` から `develop` への PR にする。commit は `<type>: <概要>` とし、type は `feat`、`fix`、`refactor`、`test`、`docs`、`chore` から選ぶ。通常 PR は変更理由と gate が一つの単位で確認できる大きさに保ち、squash merge する。

本番へ出す commit を選んだら、その `develop` commit を指す短命な `release/YYYYMMDD-N` branch を作り、`master` への release PRを作る。release branch に release 専用の内容変更を追加しない。`master` の required status check が最新baseへの追従を要求する場合だけ、選択した `develop` commitを第1親、現在の `master` を第2親とし、treeを第1親から変えない同期mergeを1件許可する。release PR は merge commit で取り込み、`master` へ直接 push しない。これにより、release PR 作成後に `develop` へ入った変更は次回 release まで含まれず、base更新も候補内容を変えない。

一人開発のため、`develop` と `master` の required approval 数は 0 とする。これは人間のレビューがないという意味ではなく、確認の時期・深さを固定しない。PR は変更の必要性と結果を先に述べ、検証の範囲・重要な判断・未確認事項から必要な差分や正本へ辿れるようにする。

両 branch とも PR、`pr-ready`、会話解決を必須にし、merge 実行者は repository の write 権限を持つ owner に限定する。`develop` は squash merge のみ、`master` は merge commit のみを許可する。release PR は同一 repository の `release/*` からだけ受け付け、選択したsnapshotが前回 release 以降かつ `develop` 履歴上の commitであることを CI で検証する。同期mergeがある場合は、親の順序、現在の `master` との一致、選択したsnapshotとのtree一致も検証する。

Linear issue を完了させる通常 PR は本文で `Fixes MOM-<番号>` を使う。`develop` merge は started status `Ready for release`、release PR の `master` merge は `Done` の境界として扱うため、release PR に対象 issue の `Fixes MOM-<番号>` をもう一度列挙する。commit message の magic word に issue lifecycle を依存させない。release PR を開いた時点で既存 status を後退させず、複数 PR に紐づく issue は最後の対象 PR が merge されるまで完了扱いにしない。

release PR は含まれる PR を列挙し、`## Release notes` に利用者向けの変更を記載する。通常 PR の Release notes は `N/A` でよいが、release PR の空欄や placeholder は CI で拒否する。本文と公開 release note の公開範囲は `AGENTS.md` に従う。
