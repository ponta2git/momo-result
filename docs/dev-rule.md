# 開発作業規約

目的: ローカル環境、起動、E2E suite、検証コマンド、変更 gate、作業の並列化、Git 運用を判断する。version、script、CI job の現在値は package manifest、toolchain 設定、CI workflow を正本とする。

何を証明するかは [テスト・品質規約](test-rule.md)、test の実行構成は [テスト実行設計](test-architecture.md)、DB は [DB 規約](db-rule.md)、CI の分類・release 候補・配備・rollback は [CI・リリース規約](release.md) を参照する。判断、報告、完了の原則は [AGENTS.md](../AGENTS.md) に従い、本書は作業固有の手順だけを持つ。

## Environment

- local secret は追跡外の env file、production / CI secret は各 secret store で管理し、必要な名前だけを `.env.example` に置く。
- API / worker の env の読込元は、実際の起動経路で確認する。worker container には worker が使う secret だけを渡す。
- 隔離 test の既定 migration source は共通 resolver が `.momo-db-ref` に固定した `momo-db` commit から解決する。checkout の HEAD はその commit と異なってよい。固定 revision の archive や意図した schema 実験は `MOMO_DB_MIGRATIONS_DIR` で明示し、検証した前提を報告で区別する。判定の現在値は `scripts/ci/resolve-momo-db-migrations.sh` を正本とする。
- API は `.http4s-ref` に固定した http4s fork で build・test する。ローカルでは root で `scripts/ci/build-http4s-patch.sh` を実行し、fork を `~/.ivy2/local` へ publish して版を `_deps/http4s-patch` に記録する。`apps/api/build.sbt` はこの記録か `MOMO_HTTP4S_PATCHED_VERSION` を使い、未準備や固定 revision との不一致では upstream へ fallback せず依存解決の前に失敗する。ref を更新したら再実行し、sbt server を再起動する。
- integration / E2E は普段使いの DB、bucket と分離する。
- Web / runtime E2E の fresh DB bootstrap は `web-e2e` profile で現行の分析公開契約を初期化する。migration だけの baseline と区別し、既存 DB の正式な promotion や本番切替とは別の手順として扱う。

隔離と接続先を確認できるローカル検証は、依頼された変更の検証・失敗修正・影響範囲の再実行まで個別承認なしで進める。任意 target や live provider を使う command は、この前提の対象外として実際の接続先と副作用を確認する。

## Local Run

- 通常の API + Web は root の `pnpm dev` を使う。Node の version は `mise.toml`、利用可能な command は各 `package.json` を正とする。
- 依存 DB の起動と migration は対象 `momo-db` checkout の scripts を使う。checkout の特定は [DB 規約](db-rule.md#ownership) に従う。
- `pnpm dev` が起動するのは API + Web であり、Processing Worker は別に起動する。worker の process isolation は Linux runtime が前提なので、macOS でも `apps/processing-worker/Dockerfile` から build した専用 container で実行する。worker の env は専用 env file だけとし、明示的な memory / cgroup 設定を渡す。
- runtime image は `scripts/ci/`、DB control plane と待機優先・実行継続は `scripts/e2e/` の対応 smoke と同じ境界で検証する。
- local volume のデータが消えたように見えたら、書込みや volume 削除を止めて mount と PostgreSQL major version を確認する。data directory は同じ major version の PostgreSQL にだけ mount する。
- システム E2E は毎回新しい隔離環境を作り、終了・失敗・中断時に所有資源を回収する。対象は runner が作成した DB と runtime に限る。

algorithm version の昇格、本番候補の build、backfill、credential rotation は、ローカル起動とは別に [CI・リリース規約](release.md) に従う。

## E2E Suites

全 suite は Node と、runner が使う Web の依存関係を用意する。UI・システム・回復 E2E は Playwright のブラウザを使う。システム・回復 E2E と通知契約は Docker、host の `jq`、`.momo-db-ref` に適合する migration、依存を install・build 済みの `.summit-ref` に固定した Summit checkout を使う。既定の配置は `_deps/momo-db` / `_deps/summit`。各 checkout の package manager で必要な依存を準備し、migration の準備は [DB 規約](db-rule.md#ownership) に従う。migration は runner が新しい DB に適用する。

| suite | command | 検証対象 | 用意する image |
| --- | --- | --- | --- |
| UI E2E | `pnpm web:e2e:ui` | ビルド済み Web と明示した HTTP 応答だけでブラウザ操作を検証する | なし |
| システム E2E | `pnpm e2e` | 実 Runtime / Worker を通す保存・OCR・分析・通知・権限と、記録操作の回復 | Runtime の production image を `MOMO_E2E_RUNTIME_IMAGE`、Worker の production image を `MOMO_E2E_WORKER_IMAGE`、その Runtime に対応する session fixture を `MOMO_E2E_SESSION_FIXTURE_DIR` に指定 |
| 回復 E2E | `pnpm e2e:recovery` | 制御 Worker を使う OCR の回復と、ブラウザを使わない通知結合契約 | Runtime の production image を `MOMO_E2E_RUNTIME_IMAGE`、Worker の `e2e-test` target を `MOMO_E2E_CONTROLLED_WORKER_IMAGE`、session fixture を `MOMO_E2E_SESSION_FIXTURE_DIR` に指定 |
| 通知契約 | `pnpm test:notification-contract` | 独立 DB で分析通知 producer と固定 Summit consumer の上限・描画互換性 | Worker の `e2e-test` target を `MOMO_E2E_CONTROLLED_WORKER_IMAGE` に指定 |

ローカルでは `pnpm e2e:prepare` が作業ツリーから上記の image と session fixture（root `Dockerfile` の `e2e-session-fixture` target）を CI と同じ Dockerfile target で build し、指定する環境変数を `target/e2e/prepared.env` に書く。commit SHA による再利用はせず、変更は BuildKit の内容単位 cache で再 build される。runner は開始時に immutable image ID を確定し、session fixture がその Runtime image ID に対応しない場合は資源を作る前に失敗する。runner は build や sbt へ fallback しない。CI は同じ runner と suite を実行し、制御 Worker と session fixture は producer job で build した artifact を来歴検証してから渡す。各 suite の保証範囲は [テスト実行設計](test-architecture.md#web-の実行境界) を正本とする。

手動の E2E 実確認は Playwright MCP を使う。`pnpm e2e --hold`（制御 Worker は `pnpm e2e:recovery --hold`）で同じ隔離環境を保持し、表示された private metadata の接続先と session fixture を使う。metadata、cookie、CSRF、環境ファイルは手元に留める。対象ケースを実行したら runner を中断して回収する。

## Commands

日常の品質 command は root `package.json` の scripts（`web:*`、`api:*`、Worker の `analysis:format:check`・`analysis:lint`・`analysis:test`、`actionlint`、`test:policy`、`public:safety:check`）と `apps/web/package.json`、`apps/api/build.sbt` の alias を入口にする。`analysis:maintain` は `master` の本番分析 workflow を dispatch して昇格・backfill を適用し得る本番操作であり、品質 command や隔離ローカル検証とは分けて扱う（[公開運用規約](ops/README.md)、[CI・リリース規約](release.md#analysis-promotion-and-backfill)）。root scripts に入口がないものは次のとおり。

- Go runtime / tools は変更対象の `apps/runtime` または `scripts/tools` で `go test ./... && go vet ./...` を実行する。
- Processing Worker の production image build の context は root とする。

実行 command、lint 設定、smoke の引数は manifest、build 設定、`scripts/ci/`、`scripts/e2e/` を実行上の正本とする。文書と実装がずれた場合は、既存の実行入口に合わせて実装か文書を直す。ずれの解消だけを目的とする別名 command は増やさない。

## Change Gates

必要な check を選び、その結果が何を示すかを次の役割で区別する。check と記録は必要なものだけを選び、分類を埋めるためには足さない。

| 役割 | blocking | 判定対象 |
| --- | --- | --- |
| Product-value evidence | Yes | 利用者の結果、data 保全、利用者へ到達する共通実装契約 |
| Pipeline-integrity evidence | Yes | compile、生成 freshness、schema / dependency 整合、artifact provenance、workflow 自体の成立 |
| Diagnostic report | No | aggregate coverage、flake、developer wait、長期推移 |
| Manual review | Yes（選択時） | 視覚階層、関係的余白、文章の強さなど自動 oracle が不適切な項目 |

- blocking check は、所有する正本、検出する違反、失敗時の対処を特定できる場合だけ置く。pipeline-integrity evidence の成功と product behavior の成功は別々に判定する。
- manual review は、利用者影響があり自動 oracle が適切でない場合に選ぶ。エージェントによるブラウザ実確認も含み、本番操作などの人間承認とは別である。確認対象、重要な所見、限界を変更報告や PR に短く残し、確認そのものを近似的な checker や採点で代用しない。
- 既存 lint の規則一覧や flag は設定を正本とし、個々の理由も設定のコメントに置く。採用目的は次のとおりで、規則を消すときもこの目的は保つ。API の Scalafix と compiler option（`apps/api/.scalafix.conf`、`apps/api/build.sbt`）は blocking・同期実行を避けて IO runtime へ委ね、異なる型の比較は strictEquality で制約して `==` 全面禁止のノイズを足さず、import 順の差分揺れを抑える。Worker の workspace lints（`apps/processing-worker/Cargo.toml`）は crate の可視性を直接守る lint を優先し、互いに矛盾し得る restriction 群を一括で有効にせず、曖昧さ・未検査アクセス・隠れた制御フロー・診断情報の喪失を防ぐものを選ぶ。Web の oxlint（`apps/web/oxlint.config.ts`）の目的は [Web 実装規約の Layering](web-rule.md#layering) にある。いずれも違反の種類を限定して検出するもので、不具合全般の不在を保証しない。設定を変える場合はこの目的を保つか、目的ごと見直す。
- lint / checker は syntax-aware な既存 tool と設定を優先する。独自 script は、既存 tool で表現できず、利用者価値または pipeline integrity への影響が大きく、positive / negative fixture で誤検出と未検出を管理できる場合だけ採用する。
- production build が output を選別し、runtime が識別子を動的に組み立てる場合、canonical build で最終 artifact の識別子保持を検証する（oracle は [テスト・品質規約の UI Conformance](test-rule.md#ui-conformance)）。build が参照する checker、manifest、fixture は host と container の全 build input に含める。
- check の廃止時は、守っていた価値と証拠を [テスト・品質規約](test-rule.md#品質証拠の採用維持削除) の基準で再評価し、同等 check の要否もその結果で決める。
- 一つの command に複数 check をまとめても、契約の検証と診断を区別する。Diagnostic report の欠測や閾値超過は、blocking command の成否と切り離して扱う。

| 変更 | 必須 gate |
| --- | --- |
| Web production | format、lint、typecheck + 選択した unit / component evidence |
| Web test のみ | format、lint、typecheck + 変更・統合後の対象 suite。E2E / runner を変える場合はその実行境界も検証 |
| Web API contract | Web gate + Tapir 由来 OpenAPI の生成・構造 lint・freshness + Web 型生成 / typecheck |
| Web build / runtime | Web gate + build |
| login、試合記録、OCR、比較、export の主要 UI flow | Web gate + 影響する利用者契約の Playwright |
| API endpoint / usecase / domain / codec | API quality + 選択した unit / contract evidence |
| PostgreSQL repository / DB 前提 | API gate + 変更経路の DB quality |
| OCR job / scheduler | API / Worker gate + 変更経路の DB / process contract |
| R2 image storage | API / DB gate + 変更経路の R2 quality / reconciler readiness |
| Processing Worker production | format、Clippy、production image build + 選択した target / feature evidence |
| analysis algorithm version | Worker gate + release DB / control-plane compatibility |
| worker DB / process / isolation | Worker gate + 対象 control-plane、scheduling、image smoke |
| runtime / deploy config | public safety、image build / scan + 変更経路の runtime / memory / shutdown / Playwright evidence |
| Node 開発 / E2E tool | Web の format、lint、typecheck、scripts:check + 変更した起動・service 境界の検証 |
| Go runtime / 開発 / ops tool | 対象 module の Go test / vet、CI script を変えた場合は対応 script test |
| docs only | `git diff --check`、`pnpm public:safety:check` |

表は変更時に選ぶ evidence の種類を示すものであり、test case の追加と層の配置は [テスト・品質規約](test-rule.md) の基準で決める。規約・skill の指示、参照資料、表示名・説明・default prompt の変更は docs only とする。script、schema、実行設定や tool 依存・起動 policy も変える場合は、その実行境界の gate を加える。選択基準と oracle は [テスト・品質規約](test-rule.md)、現在の job 構成とまとめて実行する suite は CI workflow を実行上の正本とする。変更分類は変更の実態どおりに選ぶ。

### 完了前の確認と記録

- 検証の終了と再実行の範囲は [AGENTS.md](../AGENTS.md#検証と完了) に従う。過去の結果の再利用は、対象コード、依存する schema・設定・環境、観測した経路が今回の判断に適合する場合に限る。必須 gate の実行単位は CI の定義に従う。
- チケット完了前には、最終差分が影響する基本操作・回復経路を同じ suite で確認する。検証後に対象コードや候補が変わった場合は、無効になった範囲を再実行する。
- 通常の変更は PR を経由する（[Git](#git)）。ユーザーが PR を経由しない `develop` への取り込みを明示的に指示した場合に限り、最新 `develop` とのマージ予定結果を隔離 checkout で作り、そのコードから build した候補で基本操作一式と関連する回復・契約を通す。
- 手動確認の記録には、対象 commit（未 commit 差分があればその範囲）、確認した suite・ケースまたは操作、成否と未確認事項を残す。image ID は runtime / worker image を使った確認に限り、その immutable image ID を残す（文書だけの確認や image を使わない UI 確認では不要）。記録はチケット・PR・作業報告など既存の報告先へまとめる。結果のためだけの恒久的な記録帳は増やさない。
- 件数を報告する場合は、追加・削除した case 数と実行した既存 suite の総数を区別する。品質や新規回帰 test の必要性は、suite の件数ではなく [テスト・品質規約](test-rule.md#品質証拠の採用維持削除) の基準で判断する。

## Parallel Execution

並列化と subagent 分担の原則は [AGENTS.md](../AGENTS.md#判断と並列作業) が持つ。本節は repository 固有の制約だけを定める。

- 次の判断に必要な前提を確かめたら、独立した検索・読み取り・job はまとめて並列実行する。同じ test 集合の通常実行と coverage 実行は目的に合う方へまとめ、setup と build も有効な実行結果を再利用する。test 内の並列性と隔離は [テスト実行設計](test-architecture.md#parallelism) に従う。
- subagent には目的・担当範囲・必要な制約・成果物を明示して渡す（親の指示は継承されないものとして扱う）。独立した調査・検証を分担し、未確定の判断に依存する作業は判断が揃ってから進める。編集範囲は担当間で調整し、主担当が差分と必要な検証を確認して統合する。委任数や並列率は手段であり、達成目標にはしない。
- shared service、生成先、DB、CPU / memory の競合と結果の統合負担を含めて並列度を決める。workflow の直列化に固有の理由がある場合は設定の近くに残す。
- 待ち時間の測定は、遅い工程や改善の効果を判断する必要がある場合だけ加える。timestamp や最初の failed step は一側面の観測であり、作業効率全体は別に判断する。数値予算・常設 telemetry を導入する前に、不要な実行や依存関係を整理する。予算が必要なら代表条件と変動幅を示し、local の個人 telemetry は収集しない。

## Git

- `develop` を default branch とし、通常の変更は `<type>/<short-description>` から `develop` への PR にする。commit は `<type>: <概要>` とし、type は `feat`、`fix`、`refactor`、`test`、`docs`、`chore` から選ぶ。通常 PR は変更理由と gate が一つの単位で確認できる大きさに保ち、squash merge する。
- 本番へ出す変更を短命な `release/YYYYMMDD-N` branch にまとめ、`master` への release PR を作る。通常は選択した `develop` commit から作り、必要に応じて `master` からの revert や release 専用の修正を含めてよい。release branch は `develop` の履歴外にあってよく、前回 release 以降の snapshot である必要もない。`master` への変更は merge commit で取り込む release PR だけとする。merge 後の deploy と GitHub Release の発行は [CI・リリース規約](release.md#deploying-runtime-and-worker) に従う。
- 一人開発のため、`develop` と `master` の required approval 数は 0 とする。この設定は、人間のレビューの時期・深さを変更ごとに選べるようにするためのものである。PR は変更の必要性と結果を先に述べ、検証の範囲・重要な判断・未確認事項から必要な差分や正本へ辿れるようにする。
- 両 branch とも PR、`pr-ready`、会話解決を必須にし、merge 実行者は repository の write 権限を持つ owner に限定する。`develop` は squash merge のみ、`master` は merge commit のみを許可する。release PR の branch 条件と Release notes の検査範囲は `scripts/ci/check-pr-branch-policy.sh` を正本とする。
- Linear issue を完了させる通常 PR は本文で `Fixes MOM-<番号>` を使う。`develop` merge は started status `Ready for release`、release PR の `master` merge は `Done` の境界として扱うため、release PR に対象 issue の `Fixes MOM-<番号>` をもう一度列挙する。issue lifecycle の根拠は commit message の magic word ではなく PR 本文の記載とする。release PR の作成時も到達済みの進捗を保ち、複数 PR に紐づく issue の完了扱いは最後の対象 PR の merge 後に限る。
- release PR は含まれる PR を列挙し、`## Release notes` に利用者向けの変更を記載する。通常 PR の Release notes は `N/A` でよい。本文の構成は [PR template](../.github/pull_request_template.md)、本文と公開 release note の公開範囲は [AGENTS.md](../AGENTS.md#作業境界) に従う。
