# 初回本番デプロイ手順

目的: `momo-result` を初めて Fly.io 本番環境へデプロイするための手順を固定する。

本番は `https://momo-result.fly.dev` から開始し、カスタムドメインは後日導入する。DB は summit と共用の Neon PostgreSQL を使い、スキーマと migration は `../momo-db` を正本にする。

## 1. 方針

- デプロイトリガーは default branch `master` merge 後の GitHub Actions。
- `production` Environment の required reviewer 承認後だけ Fly.io deploy を実行する。
- 初回は `workflow_dispatch` で同じ経路を手動実行して確認する。
- 本番 secrets は Fly.io secrets、CI secrets は GitHub Actions secrets で管理する。
- 秘密情報はチャット、Issue、PR本文、ログへ貼らない。

## 2. 事前準備

### 2.1 GitHub Environment

GitHub repository の Settings で以下を設定する。

1. `Settings` -> `Environments` -> `New environment`
2. Name: `production`
3. `Required reviewers` に本番承認者を設定する。
4. 必要なら deployment branches を `master` に制限する。

この repository の `.github/workflows/deploy.yml` は `deploy` job で `environment: production` を参照する。Environment が未作成でも workflow は承認待ちにできないため、初回 deploy 前に必ず作る。

### 2.2 GitHub Secrets

`Settings` -> `Secrets and variables` -> `Actions` に以下を登録する。

| Secret | 用途 |
|---|---|
| `FLY_API_TOKEN` | GitHub Actions から Fly.io へ deploy するための token |
| `MOMO_DB_READ_TOKEN` | `momo-db` が private repository の場合に migrations を checkout する token。不要なら省略可 |

`FLY_API_TOKEN` は Fly.io 側で deploy 権限に絞った token を使う。

### 2.3 Fly.io app

app が未作成なら作成する。

```sh
flyctl apps create momo-result --org <fly-org>
```

app があるか確認する。

```sh
flyctl status --app momo-result
```

`fly.toml` の前提:

- app: `momo-result`
- primary region: `nrt`
- runtime VM: `shared-cpu-1x`, memory `1gb`
- public URL: `https://momo-result.fly.dev`
- health check: `/healthz`

### 2.4 Upstash Redis

OCR queue と rate limit 用に Upstash Redis を作成する。

```sh
flyctl redis create \
  --name momo-result-redis \
  --region nrt \
  --no-replicas \
  --disable-eviction \
  --plan Pay-as-you-go \
  --enable-prodpack=false
```

作成時の出力に Redis connection string が表示される。

Fly.io 上の Upstash Redis URL を `REDIS_URL` として使う。

### 2.5 Discord OAuth

Discord Developer Portal で application を作成し、OAuth2 redirect URI に以下を登録する。

```text
https://momo-result.fly.dev/api/auth/callback
```

取得する値:

- Client ID -> `DISCORD_CLIENT_ID`
- Client Secret -> `DISCORD_CLIENT_SECRET`

このアプリは OAuth scope `identify` だけを使う。

### 2.6 Neon / momo-db migration

本番 DB は summit と共用する。アプリ deploy 前に `momo-db` の本番 migration が適用済みであることを確認する。

`momo-db` 側の通常経路:

```sh
cd ../momo-db
pnpm build
pnpm db:check
```

未適用 migration がある場合、初回デプロイでは `momo-db` の `master` push による CI/CD で本番 Neon へ先に適用する。緊急時以外は `momo-result` 側から本番 DB へ migration SQL を直接流さない。破壊的 migration がある場合は、アプリ deploy と分けて rollback 方針を確認するまで進めない。

`momo-db` CI の `Migrate Neon` が失敗した場合は、GitHub Actions の `Run migration` step のエラー本文を確認する。あわせて `momo-db` repository の GitHub Environment `CI Actions` にある `DIRECT_URL` が、Neon の Direct connection の本番 URL であることを確認する。pooler URL や local URL を使わない。

適用後は Neon の `drizzle.__drizzle_migrations` と必要テーブルを確認する。2026-05-24 時点の `momo-result` 初回デプロイでは、`momo-db` の `0000`〜`0016` までが適用済みで、少なくとも以下のテーブルが存在する必要がある。

- `momo_login_accounts`
- `match_drafts`
- `matches`
- `ocr_jobs`
- `ocr_drafts`
- `ocr_queue_outbox`
- `idempotency_keys`

初期管理者は migration seed 済みの `account_ponta` を使う。

## 3. Fly secrets

Fly.io app に secrets を設定する。

必須:

| Secret | 値 |
|---|---|
| `DATABASE_URL` | summit と共用する Neon PostgreSQL 接続文字列。prod では `sslmode=require` 以上を使う |
| `REDIS_URL` | Upstash Redis connection string |
| `DISCORD_CLIENT_ID` | Discord OAuth application の Client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth application の Client Secret |
| `DISCORD_REDIRECT_URI` | `https://momo-result.fly.dev/api/auth/callback` |
| `AUTH_STATE_SIGNING_KEY` | OAuth state 署名用の十分長いランダム値 |

任意で明示:

| Secret | 推奨値 |
|---|---|
| `AUTH_COOKIE_SECURE` | `true` |
| `AUTH_COOKIE_HOST_PREFIX` | `true` |

`AUTH_STATE_SIGNING_KEY` はローカル端末で生成する。

```sh
openssl rand -base64 32
```

secrets は `flyctl secrets import` で標準入力から登録する。入力内容は shell history に残さない。

```sh
flyctl secrets import --app momo-result
```

貼り付ける内容の例:

```text
DATABASE_URL=postgres://...
REDIS_URL=redis://...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://momo-result.fly.dev/api/auth/callback
AUTH_STATE_SIGNING_KEY=...
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_HOST_PREFIX=true
```

入力後、Ctrl-D で終了する。

登録済み secret 名を確認する。

```sh
flyctl secrets list --app momo-result
```

## 4. 初回 deploy

初回は GitHub Actions の `deploy` workflow を `workflow_dispatch` で実行する。

1. GitHub -> `Actions` -> `deploy` -> `Run workflow`
2. branch は `master`
3. `Runtime smoke and E2E` の成功を確認する。
4. `deploy` job が `production` approval で待機する。
5. 承認者が内容を確認して approve する。
6. `Deploy to Fly.io` が成功することを確認する。

ローカルから直接 deploy する場合は、CI と Environment approval を通らないため初回手順では使わない。緊急時だけ `docs/ops/runbook.md` の手動 deploy 手順を参照する。

## 5. デプロイ後確認

Fly.io 側:

```sh
flyctl status --app momo-result
flyctl logs --app momo-result --no-tail
flyctl releases --app momo-result --image
```

HTTP health:

```sh
curl -fsS https://momo-result.fly.dev/healthz
```

期待値:

- `/healthz`: `{"status":"ok"}`
- `/healthz/details`: 未認証では 401。管理者ログイン後に `status`, `database`, `redis`, `ocrAdmission` が `ok` であることを確認する。

人間 smoke:

1. `https://momo-result.fly.dev` を開く。
2. Discord OAuth で「ぽんた」アカウントとしてログインできる。
3. 管理画面でログインアカウント一覧が見える。
4. 開催履歴を1件作成できる。
5. OCR取り込み画面で画像 upload と OCR job 作成ができる。
6. 下書き確認から試合を確定できる。
7. CSV/TSV export をダウンロードできる。

失敗時はここで止める。DB migration 不足、Redis URL、Discord redirect URI、secret 名のどれかを優先的に確認する。

## 6. 初回 rollback

直前の release image を確認する。

```sh
flyctl releases --app momo-result --image
```

アプリだけ戻す場合:

```sh
flyctl deploy --app momo-result --image <previous-image>
```

DB migration は自動で戻らない。`momo-db` migration 適用後に問題が出た場合は、アプリ rollback だけで戻せるかを先に判断し、DB 変更の reverse / point-in-time restore は別途人間判断にする。

## 7. カスタムドメイン導入時

後日カスタムドメインへ切り替えるときの作業:

1. Fly.io に証明書を追加する。

```sh
flyctl certs add <domain> --app momo-result
flyctl certs check <domain> --app momo-result
```

2. DNS を Fly.io の指示通り設定する。
3. Discord OAuth redirect URI に `https://<domain>/api/auth/callback` を追加する。
4. Fly secret `DISCORD_REDIRECT_URI` を新ドメインへ更新する。
5. GitHub Environment の URL を新ドメインへ更新する。
6. `https://<domain>/healthz` と OAuth login を確認する。

切替直後は `momo-result.fly.dev` も残し、ログイン確認後に必要なら旧 redirect URI を整理する。
