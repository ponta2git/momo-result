# Public Operations Policy

目的: public repository に置ける運用原則だけを残す。

公開範囲と private の参照条件は [AGENTS.md](../../AGENTS.md) に従う。詳細な本番 runbook、provider dashboard 手順、攻撃対策、実測値、kill switch は `private/ops/` に置く。通常 release、Analysis 昇格、rollback の人間向け正本は `private/ops/runbook.md`。`private/ops/production-deploy.md` は初回構築時の履歴であり、現行手順として実行しない。

## Public Rules

- 本番変更、provider の設定反映、課金・quota・DNS・WAF・Machine の変更操作にはユーザーの承認が必要である。同じ対象・範囲への明示的な実行依頼や既存の承認を使い、工程ごとに再承認を求めない。
- 調査、差分作成、ローカル検証は依頼の範囲で進める。承認が残る、または対象・手順を確認できない本番操作だけを保留し、それまでに準備できる差分、対象、影響、検証結果を揃えて確認を求める。private の参照許可と本番変更の承認は別に扱う。
- DB schema / migration の所有権と事前手順は `AGENTS.md` と `docs/db-rule.md` に従う。
- deploy や runtime に必要な非 secret 設定は `fly.toml` と CI 設定を正とする。
- production deploy / rollbackは同じ承認境界を通し、CIに記録したcommit・設定・artifact identityを照合できない候補を適用しない。
- 旧候補の停止状態での復元は、旧アプリの通常起動や readiness の確認とは分ける。旧候補に新しい maintenance 観測機能がない場合も、その起動を検証の代わりにしない。通常再開には、承認済みの rollback 手順で DB と consumer の互換性・復旧状態を確認する。
- 共有 DB の非互換切替と切戻しは [DB 利用規約](../db-rule.md#5-migration--deployment) に従い、全 writer 停止と対応する DB・consumer の組を承認時に確認する。CI の使い捨て DB に対する検証は、本番への migration 適用の証拠にしない。
- release の候補選択、branch、merge 方法、公開履歴は `docs/dev-rule.md` の CI Gates / Release と Git を正本とする。`master` への release PR merge は deploy を開始する本番操作として扱う。
- exactなworkflow入力、action、timeout、artifact名はCI設定を正とし、private runbookは人間の判断順序、承認条件、成功証拠、失敗後の状態確認を定める。
- 手順や監視を増やす前に、既存の仕組みで判断・復旧できるかを確認する。観測は具体的な運用判断に必要なものを選び、health、機能応答、性能の一つだけで全体を成功としない。測定できない状態や残る不確実さは明記し、根拠のない数値で埋めない。
