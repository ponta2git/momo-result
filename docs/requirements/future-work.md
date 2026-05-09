# Future Work

この文書は、MVPから意図的に外したが将来検討する価値がある要求を記録する。

## オブザーバビリティツール導入

MVPでは Fly.io の stdout/stderr ログ、API/OCR worker の構造化JSONログ、`/healthz/details` を主な運用手段とする。Sentry、OpenTelemetry、外部ログシンクなどの導入は本番運用で Fly.io ログだけでは障害原因の特定が継続的に難しいと判断した段階で再検討する。

導入時は、以下を満たすことを条件にする。

- session id、CSRF secret、OAuth token、DB/Redis URL、画像内容、OCR raw text 全文を送信しない。
- API と OCR worker の `request_id` / `job_id` を横断検索できる。
- 無料枠または低コストで固定4名運用に見合う。
- SDK追加により本番起動やOCR処理が失敗しないよう、送信失敗時はログ出力だけで処理継続する。
