# 本番運用マニュアル

目的: 初回デプロイ後の通常運用、障害確認、rollback、secret rotation、カスタムドメイン導入の手順をまとめる。

本番 URL は初期状態では `https://momo-result.fly.dev`。DB は summit と共用の Neon PostgreSQL、Redis は Upstash Redis、runtime は Fly.io の単一 app `momo-result`。
現在の Fly VM は `shared-cpu-1x` / memory `1gb` を前提にする。256MB では Java API と OCR worker が同居できず、nginx の `/healthz` upstream が `connection refused` になる。

## 1. 通常 deploy

1. PR を作る。
2. 変更範囲の quality gate を通す。
3. GitHub Actions の required checks が通ることを確認する。
4. PR を default branch `master` に merge する。
5. `deploy` workflow の `Runtime smoke and E2E` が通ることを確認する。
6. `production` Environment approval を承認する。
7. deploy 完了後に health と主要導線を確認する。

確認コマンド:

```sh
curl -fsS https://momo-result.fly.dev/healthz
flyctl logs --app momo-result --no-tail
```

## 2. DB migration を伴う deploy

DB schema / migration の正本は `../momo-db`。

後方互換な DB 変更:

1. `momo-db` に migration を追加する。
2. `momo-db` の `master` push による CI/CD で本番 Neon へ先に適用する。
3. `momo-result` の consumer deploy を行う。
4. `/healthz/details` と DB-backed の主要導線を確認する。

緊急時以外は `momo-result` 側から本番 DB へ migration SQL を直接流さない。

`momo-db` CI の `Migrate Neon` が失敗した場合は、GitHub Actions の `Run migration` step のエラー本文を確認する。`DIRECT_URL` は `momo-db` repository の GitHub Environment `CI Actions` で管理し、Neon の Direct connection の本番 URL を使う。

後方互換でない変更、NOT NULL 追加、型変更、大量 backfill、旧 schema 削除:

- migration と consumer deploy を分割する。
- rollback 方針、未移行データの扱い、summit 側への影響を確認するまで deploy しない。

## 3. 手動 deploy

通常は GitHub Actions 経由だけを使う。緊急時にローカルから deploy する場合:

```sh
flyctl deploy --remote-only --app momo-result
```

手動 deploy 後も必ず health と smoke を行う。

## 4. Health とログ

軽量 health:

```sh
curl -fsS https://momo-result.fly.dev/healthz
```

詳細 health:

`/healthz/details` は管理者認証が必要。未認証の `curl` は 401 になる。

期待値:

- `database`: `ok`
- `redis`: `ok`
- `ocrAdmission`: `ok`
- いずれかが `unavailable` または `degraded:*` なら新規 OCR 受付や外部依存を確認する。

Fly logs:

```sh
flyctl logs --app momo-result
flyctl logs --app momo-result --no-tail
```

ログに出してはいけないもの:

- DB URL
- Redis URL
- session / CSRF / OAuth token
- 画像内容
- OCR raw text 全文
- 例外 message / stack trace の直接出力

## 5. OCR / Redis 障害対応

見る順序:

1. `/healthz/details` の `redis` と `ocrAdmission`
2. Fly logs の `ocr_job_*`, `OCR admission`, `ocr_queue_outbox`, worker error
3. Neon の `ocr_jobs`, `ocr_queue_outbox`
4. Redis stream length, consumer group pending, dead-letter stream

Redis queue の契約は `docs/redis-streams-ocr-contract.md` を正本にする。

症状別:

| 症状 | 初動 |
|---|---|
| `redis=unavailable` | `REDIS_URL` secret、Upstash status、Fly logs を確認 |
| `ocrAdmission=degraded:*` | outbox backlog、DLQ、Redis pending を確認 |
| OCR job が進まない | worker process log、Redis pending、`ocr_jobs.status` を確認 |
| DLQ が増える | payload validation error、画像一時ファイル消失、worker例外を確認 |

処理中画像は Fly VM の一時ディスクにある。VM restart 等で消えた場合は仕様上 OCR 失敗として扱い、ユーザーに再アップロードしてもらう。

## 6. Discord OAuth 障害対応

見る順序:

1. Discord Developer Portal の redirect URI
2. Fly secret `DISCORD_REDIRECT_URI`
3. `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
4. `AUTH_STATE_SIGNING_KEY`
5. Fly logs の `auth_*` event

`Invalid redirect_uri` が出る場合、Discord 側に登録した URI と `DISCORD_REDIRECT_URI` が完全一致しているか確認する。

本番では `AUTH_COOKIE_SECURE=true`、`AUTH_COOKIE_HOST_PREFIX=true` を維持する。

## 7. Rollback

release と image を確認する。

```sh
flyctl releases --app momo-result --image
```

前の image へ戻す。

```sh
flyctl deploy --app momo-result --image <previous-image>
```

rollback 後:

```sh
curl -fsS https://momo-result.fly.dev/healthz
flyctl logs --app momo-result --no-tail
```

DB migration は戻らない。schema 互換性が壊れている場合は、アプリ rollback だけで復旧しない可能性がある。

## 8. Secret rotation

Fly secrets を更新する。

```sh
flyctl secrets set KEY=value --app momo-result
```

複数 secret をまとめて更新する場合:

```sh
flyctl secrets import --app momo-result
```

更新後に確認する。

```sh
flyctl secrets list --app momo-result
curl -fsS https://momo-result.fly.dev/healthz
```

Discord secret rotation 後は OAuth login を確認する。Redis / DB secret rotation 後は `/healthz/details` と OCR受付を確認する。

## 9. カスタムドメイン導入

1. Fly certificate を追加する。

```sh
flyctl certs add <domain> --app momo-result
flyctl certs check <domain> --app momo-result
```

2. DNS を Fly.io の表示に従って設定する。
3. Discord OAuth redirect URI に `https://<domain>/api/auth/callback` を追加する。
4. Fly secret を更新する。

```sh
flyctl secrets set DISCORD_REDIRECT_URI=https://<domain>/api/auth/callback --app momo-result
```

5. GitHub Environment `production` の URL を `https://<domain>` に更新する。
6. 新ドメインで `/healthz`, 管理者ログイン後の `/healthz/details`, OAuth login を確認する。

## 10. エスカレーション基準

以下は作業を止めて人間判断にする。

- DB migration が破壊的変更を含む。
- `/healthz/details` が `degraded` のまま原因が特定できない。
- Redis DLQ が増え続ける。
- Discord OAuth provider の 429 / 5xx が継続する。
- Fly.io / Neon / Upstash の plan 変更が必要そう。
- DB の point-in-time restore が必要そう。
