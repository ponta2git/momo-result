# Public Operations Policy

目的: public repository に置ける運用原則だけを残す。

詳細な本番runbook、provider dashboard手順、攻撃対策、実測値、kill switch、secret名以外の設定値は `private/ops/` に置く。通常release、Analysis昇格、rollbackは `private/ops/runbook.md`、初回構築は `private/ops/production-deploy.md` を人間向け正本とする。`private/ops/` はgit管理外であり、通常のAI作業では読まない。

## Public Rules

- 本番変更、provider 設定変更、課金・quota・DNS・WAF・Machine 操作は人間承認後に行う。
- secret、token、DB URL、Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ貼らない。
- DB schema / migration の正本は `../momo-db`。
- deploy や runtime に必要な非 secret 設定は `fly.toml` と CI 設定を正とする。
- production deploy / rollbackは同じ承認境界を通し、CIに記録したcommit・設定・artifact identityを照合できない候補を適用しない。
- exactなworkflow入力、action、timeout、artifact名はCI設定を正とし、private runbookは人間の判断順序、承認条件、成功証拠、失敗後の状態確認を定める。
- public docs に本番 topology、VM size、Machine 数、IP、rate limit 閾値、攻撃対策 gap、遮断 endpoint を書かない。
- 障害調査で詳細runbookが必要な場合は、人間が上記private ops文書の参照可否を判断する。

## AI Guidance

- public docs だけで判断できない本番運用作業は、推測で実行しない。
- `private/ops/` はユーザーが明示した場合だけ読む。
- public repo に運用詳細を追加しそうになったら、公開リスクを説明して `private/ops/` への配置を提案する。
