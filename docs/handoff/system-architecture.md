# システムアーキテクチャ引き継ぎ

## runtime logging: nginx error log sanitization

- 状態: handoff
- 起点: 2026-05-30 system architecture cycle 1
- 品質観点: security, operability

runtime nginx access log は `$request` ではなく `$uri` を記録する JSON 形式へ変更済み。
通常の Fly logs には OAuth callback の `code/state` などの query string を出さない。

残課題: 標準 nginx の `error_log` は JSON 形式化できず、upstream error 時に full request
target を含み得る。現時点の緩和策は `error_log ... crit` とし、通常診断は API / worker /
health / supervisor logs に寄せること。厳密な nginx error log の構造化が必要になった場合は、
外部ログプロセッサ、別 reverse proxy、または sanitized structured error log を出せる nginx
module の採用を検討する。

## edge protection: Cloudflare WAF / rate limiting

- 状態: handoff
- 起点: 2026-05-30 system architecture cycle 20
- 品質観点: security, reliability, cost operability

アプリ内では login / upload / export rate limit、CSRF、session、body size limit、Host /
origin lock を実装済み。ただし IP rotate / bot traffic が高コスト endpoint を連打する場合、
アプリ内 limiter 到達前に bandwidth、TLS、nginx/API、Redis/DB を消費し得る。

残課題: Cloudflare WAF / Rate Limiting Rules による edge 側の細粒度制御は、Cloudflare plan
と provider 設定変更が前提になるため、このサイクルでは実装しない。

この handoff を共有可能な正本とする。`docs/tmp/` や `docs/ops/` 配下のローカル運用メモは
git 管理外のため、引き継ぎ前提にしない。

再開条件:

- Cloudflare Pro+ などで `http.host == "momo-result.ponta.me"` を条件にできる。
- Fly / Cloudflare / API logs で OCR 作成、source image download、export、auth への高頻度
  abuse が実測された。
- bandwidth / TLS / nginx / API / Redis / DB の消費が、アプリ内 rate limit 到達前に費用・可用性
  リスクになっている。

再開時の推奨順序:

1. 対象 host / path / action / duration / rollback を書き、人間承認を得る。
2. まず `log` または低影響の challenge で hit と誤爆を観測する。
3. OAuth callback、OCR 3枚連続 upload、source image download、CSV/TSV export が正常に通ることを
   確認する。
4. `*.fly.dev` 直アクセス、Cloudflare proxy 経由、custom domain 経由を分けて確認する。
5. block を入れた場合は解除条件と解除手順を同じ変更記録に残す。
