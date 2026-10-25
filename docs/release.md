# CI・リリース規約

目的: CI の変更分類と evidence の配置、release 候補の来歴、runtime / Processing Worker の配備、分析の昇格と backfill、credential rotation、rollback の検証について、public repository に置ける規約を定める。workflow、service、timeout、artifact path、action の現在値は CI 設定を正本とし、本書ではその正本を参照する。

本番操作の承認境界は [公開運用規約](ops/README.md)、人間の承認・復旧判断・通知の受信設定は `private/ops/runbook.md` を正本とする。branch と PR の規則は [開発作業規約の Git](dev-rule.md#git)、retry の結果分類と report artifact は [テスト実行設計](test-architecture.md#ci-artifacts)、変更ごとの必須 gate は [Change Gates](dev-rule.md#change-gates) に従う。

## CI Classification and Evidence

- CI は変更範囲を fail closed で分類し、対象 subsystem の gate を通す。
- PR では compile / lint / generation などの pipeline integrity、選択した S / M evidence、変更境界に応じた DB contract、影響する主要 user flow を優先する。endurance、resource limit、live provider は、PR でしか検出できない変更を除き release evidence へ分離する。
- release PR が検証するのは branch policy と公開情報であり、アプリ・image の gate は通常 PR と exact `master` commit の本番候補で実行する。最終 gate の失敗は merge 後に判明するが、本番変更は必要な候補の検証がすべて成功してから開始する。
- 公開 edge、内部 health、機能応答、resource / performance は別の観測点・証拠として扱う。gate は security policy を保ったまま通す。

## Release Candidate and Provenance

- release 候補は一度だけ build し、commit、設定、immutable artifact identity、digest、producer attempt を記録する。後続 smoke / deploy / rollback は同じ候補を使う。
- 外部 action / provider の値は境界で検証・正規化し、consumer 用の表現はその結果から確定する。workflow 再実行時も、候補 identity は current attempt から再計算せず記録済みの値を使う。
- provenance と検証成功の根拠には、mutable tag や cache hit ではなく immutable artifact identity と実際の検証結果を使う。

## Deploying Runtime and Worker

- runtime release は `release/*` から `master` への PR merge を境界とする。`master` push の runtime / worker deploy、post-deploy verification、必要な分析処理の完了確認がすべて成功した後、release PR の `## Release notes` を基に exact `master` commit の GitHub Release を発行する。公開 release 履歴は GitHub Releases に一元化する。
- 通常 release は runtime と Processing Worker の検証済み候補を揃え、同じ承認・排他の中で適用する。worker の候補もこの通常 release の workflow で扱う。Worker の image・設定・稼働状態が一致し、未適用の設定がない場合は再配備を省く。
- DB migration と consumer の配備順序、段階移行、全 writer 停止を伴う非互換切替は [DB 規約の Migration / Deployment](db-rule.md#migration--deployment) に従う。
- 分析成果物の非互換変更では、公開を止めて単一世代へ切り替え、再計算と監査を終えてから再開する。条件は [分析 batch 要求の Compatibility / Release / Rollback](requirements/series-analysis-batch.md#8-compatibility--release--rollback) を正本とする。

## Analysis Promotion and Backfill

- image を差し替えただけでは DB の desired version は変わらないため、algorithm version の昇格は image 更新と別操作とし、reader / worker compatibility を確認してから dry-run、apply の順で行う。DB の変更はこの操作を経由して行う。
- 分析昇格・初回 backfill は配備後の実世代と DB の状態から必要性を判定し、安全に適用できる場合は自動実行する。手動操作も同じ判定・適用・監査を使う。対象 snapshot と世代に結びついた operation を再利用し、実行中・失敗・不要・完了を区別する。自動復旧できない場合は workflow を未成功とし、理由と再開方法を記録する。
- release controller の lock 順と singleton の扱いは [DB 規約](db-rule.md#consumer-contract) と [Worker 規約](worker-rule.md#analysis-publication-and-release-control) に従う。

## Credential Rotation

- 共有 credential の rotation は、更新前に全 consumer と secret store を列挙し、同じ保守単位で更新する。完了扱いは、各 consumer が更新後の credential で新規接続し、必要な runtime peer が ready になった証拠を揃えた後に限る。
- dependency gate の evidence は [テスト・品質規約の External Service Evidence Catalog](test-rule.md#external-service-evidence-catalog) に従う。

## Rollback Verification

- rollback 対象は immutable provenance を再検証できる成功済み候補に限り、来歴は記録から確認する。
- 通常 deploy と同じ排他・承認・validator 境界を使い、target 世代で必須だった core check を確認する。
- 変更対象の UI、API、usecase、engine と、利用者影響のある production 経路を列挙し、選択した回帰 evidence がその経路を直接通すことを確認する。確認済みとするのは直接通した経路だけとする。
- deploy 成功、health、機能応答、性能回復を別々に判定する。観測不能な項目は未検証と報告する。
- 通常 rollback が扱える DB 契約・publication の範囲と、非互換切替の切戻しは [分析 batch 要求](requirements/series-analysis-batch.md#8-compatibility--release--rollback) と [DB 規約の Transitional Contracts](db-rule.md#transitional-contracts) に従う。
