# Public Operations Policy

目的: public repository に置ける運用原則だけを残す。

公開範囲と private の参照条件は [AGENTS.md](../../AGENTS.md) に従う。詳細な本番 runbook、provider dashboard 手順、攻撃対策、実測値、kill switch は `private/ops/` に置く。通常 release、Analysis 昇格、rollback の人間向け正本は `private/ops/runbook.md`。`private/ops/production-deploy.md` は初回構築時の履歴であり、現行手順として実行しない。

## Public Rules

- 本番変更、provider の設定反映、課金・quota・DNS・WAF・Machine の変更操作にはユーザーの承認が必要である。同じ対象・範囲への明示的な実行依頼や既存の承認を使い、工程ごとに再承認を求めない。
- 調査、差分作成、ローカル検証は依頼の範囲で進める。承認が残る本番操作は実行前に保留し、それまでに準備できる差分、対象、影響、検証結果を揃えて確認を求める。private の参照許可と本番変更の承認は別に扱う。
- DB schema / migration の所有権と事前手順は `AGENTS.md` と `docs/db-rule.md` に従う。
- deploy や runtime に必要な非 secret 設定は `fly.toml` と CI 設定を正とする。
- production deploy / rollbackは同じ承認境界を通し、CIに記録したcommit・設定・artifact identityを照合できない候補を適用しない。
- release の候補選択、branch、merge 方法、公開履歴は `docs/dev-rule.md` の CI Gates / Release と Git を正本とする。`master` への release PR merge は deploy を開始する本番操作として扱う。
- exactなworkflow入力、action、timeout、artifact名はCI設定を正とし、private runbookは人間の判断順序、承認条件、成功証拠、失敗後の状態確認を定める。

## AI Guidance

- public docs だけで判断できない本番運用作業は、推測で実行しない。
- public repo に運用詳細を追加しそうになったら、公開リスクを説明して `private/ops/` への配置を提案する。
