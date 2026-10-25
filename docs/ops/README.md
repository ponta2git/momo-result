# Public Operations Policy

目的: public repository に置ける本番操作の承認境界だけを残す。

公開範囲と private の参照条件は [AGENTS.md](../../AGENTS.md#作業境界) に従う。詳細な本番 runbook、provider dashboard 手順、攻撃対策、実測値、kill switch は `private/ops/` に置く。通常 release、Analysis 昇格、rollback の人間向け正本は `private/ops/runbook.md`。`private/ops/production-deploy.md` は初回構築時の履歴として参照だけに使う。

## Approval Boundary

- 本番変更、provider の設定反映、課金・quota・DNS・WAF・Machine の変更操作にはユーザーの承認が必要である。同じ対象・範囲への明示的な実行依頼や既存の承認は、その範囲の全工程に有効とする。
- 調査、差分作成、ローカル検証は依頼の範囲で進める。承認が残る、または対象・手順を確認できない本番操作だけを保留し、それまでに準備できる差分、対象、影響、検証結果を揃えて確認を求める。private の参照許可と本番変更の承認は別に扱う。
- `master` への release PR merge は deploy を開始する本番操作として扱う。
- production deploy / rollback は同じ承認境界を通し、適用する候補は CI に記録した commit・設定・artifact identity と照合できたものに限る。
- 共有 DB の非互換切替と切戻しは [DB 規約](../db-rule.md#migration--deployment) と [Transitional Contracts](../db-rule.md#transitional-contracts) に従い、全 writer 停止と対応する DB・consumer の組を承認時に確認する。

## Sources

- deploy や runtime に必要な非 secret 設定は `fly.toml` と CI 設定を正とする。exact な workflow 入力、action、timeout、artifact 名は CI 設定を正とし、private runbook は人間の判断順序、承認条件、成功証拠、失敗後の状態確認を定める。
- release の候補選択、gate、配備、公開履歴は [CI・リリース規約](../release.md)、branch と merge 方法は [開発作業規約の Git](../dev-rule.md#git) を正本とする。
- DB schema / migration の所有権と `momo-db` 変更前の手順は [AGENTS.md](../../AGENTS.md#作業境界) と [DB 規約](../db-rule.md#ownership) に従う。
- health、機能応答、resource / performance の観測点の分離は [CI・リリース規約](../release.md#ci-classification-and-evidence) に従う。
