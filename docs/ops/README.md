# Public Operations Policy

目的: public repository に置ける運用原則だけを残す。

詳細な本番 runbook、provider dashboard 手順、攻撃対策、実測値、kill switch、secret 名以外の設定値は `private/ops/` に置く。`private/ops/` は git 管理外であり、通常の AI 作業では読まない。

## Public Rules

- 本番変更、provider 設定変更、課金・quota・DNS・WAF・Machine 操作は人間承認後に行う。
- secret、token、DB URL、Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ貼らない。
- DB schema / migration の正本は `../momo-db`。
- deploy や runtime に必要な非 secret 設定は `fly.toml` と CI 設定を正とする。
- public docs に本番 topology、VM size、Machine 数、IP、rate limit 閾値、攻撃対策 gap、遮断 endpoint を書かない。
- 障害調査で詳細 runbook が必要な場合は、人間が private ops 文書の参照可否を判断する。

## AI Guidance

- public docs だけで判断できない本番運用作業は、推測で実行しない。
- `private/ops/` はユーザーが明示した場合だけ読む。
- public repo に運用詳細を追加しそうになったら、公開リスクを説明して `private/ops/` への配置を提案する。
