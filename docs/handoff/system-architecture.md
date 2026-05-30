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
