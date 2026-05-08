# 開発作業規約

## 1. ローカル環境セットアップ

### 1.1 必要ツール

| ツール | バージョン目安 | 用途 |
|---|---|---|
| Node.js | 20+ | web |
| pnpm | 9+ | webパッケージマネージャ |
| Java (JDK) | 21+ | api（Scala 3） |
| sbt | 1.10+ | apiビルド |
| Python | 3.12+ | ocr-worker |
| uv | 最新 | ocr-workerパッケージマネージャ |
| Docker | 最新 | ローカルDB/Redis起動 |
| Tesseract | 5+ | OCRエンジン（ocr-worker） |

### 1.2 環境変数

- ローカルは `.env` を使う（リポジトリにコミットしない）。
- 必要なキー名は `.env.example` を参照する。
- 本番は `fly secrets set`、CI は GitHub Actions secrets で管理する。
- Secretsをログに出力しない。

#### apiのログ出力形式

- `MOMO_LOG_FORMAT=json`（デフォルト）: 1行JSON（`@timestamp`/`level`/`logger`/`thread`/`message`/MDC各種）。本番必須。
- `MOMO_LOG_FORMAT=text`: 人間可読のpattern出力。ローカル開発向け（`.env.example` のデフォルト）。
- `MOMO_LOG_LEVEL`（デフォルト `INFO`）でルートレベルを上書き可能。
- 設定は `apps/api/src/main/resources/logback.xml`。テストは `logback-test.xml`（WARN固定、人間可読）。

### 1.3 ローカルDB・Redis起動

Redis はこのリポジトリの Docker Compose で起動する。

```sh
docker compose up -d
```

PostgreSQL は `momo-db` リポジトリの Docker Compose で起動し、migration も `momo-db` 側で適用する（`docs/db-rule.md` 参照）。

```sh
pnpm --dir ../momo-db db:up
pnpm --dir ../momo-db db:migrate
```

DB-backed API を検証する前に、接続先DBへ migration が適用済みであることを確認する。`momo-db` に migration が存在することと、ローカルDBに適用済みであることは別である。

## 2. 開発サーバー起動

各アプリは言語ごとのdevコマンドで直接起動する。ScalaとPythonは `.env` を自動読み込みしないため、起動前に `source .env` が必要。

```sh
# API（apps/api ディレクトリで）
set -a; source .env; set +a
sbt run

# OCR worker（apps/ocr-worker ディレクトリで）
set -a; source .env; set +a
uv run python -m momo_ocr worker

# Web（apps/web ディレクトリで）
pnpm dev
```

起動順序の依存: `docker compose up -d`（Redis）→ `pnpm --dir ../momo-db db:up`（PostgreSQL）→ `pnpm --dir ../momo-db db:migrate` → api → ocr-worker → web

| アプリ | コマンド | 作業ディレクトリ |
|---|---|---|
| web | `pnpm dev` | `apps/web` |
| api | `set -a; source .env; set +a && sbt run` | `apps/api` |
| ocr-worker | `set -a; source .env; set +a && uv run python -m momo_ocr worker` | `apps/ocr-worker` |

## 3. Git・コミット規約

### 3.1 ブランチ命名

```text
<type>/<short-description>
例: feat/match-confirm, fix/csrf-header, chore/update-deps
```

type: `feat` / `fix` / `refactor` / `test` / `chore` / `docs`

### 3.2 コミットメッセージ

```text
<type>: <概要>（日本語可）

<詳細・理由（任意）>
```

### 3.3 PR・マージ

- PRは最小限のスコープにする。
- CI（format / lint / typecheck / test）が通ることを確認してからマージする。
- squash mergeを基本とする。

## 4. 検証コマンド早見表

| 領域 | コマンド | 実行場所 |
|---|---|---|
| web format | `pnpm fmt` | `apps/web` |
| web lint | `pnpm lint` | `apps/web` |
| web typecheck | `pnpm typecheck` | `apps/web` |
| web test | `pnpm test` | `apps/web` |
| api format check | `sbt scalafmtCheck` | `apps/api` |
| api lint | `sbt scalafix` | `apps/api` |
| api test | `sbt test` | `apps/api` |
| api DB integration | `sbt apiDbQuality` | `apps/api` |
| api Redis integration | `sbt apiRedisQuality` | `apps/api` |
| api full local gate | `sbt apiFullCheck` | `apps/api` |
| ocr-worker format | `uv run ruff format --check .` | `apps/ocr-worker` |
| ocr-worker lint | `uv run ruff check .` | `apps/ocr-worker` |
| ocr-worker test | `uv run pytest` | `apps/ocr-worker` |

既存のスクリプトやMakefileがある場合はそちらを優先する。

### 4.1 DB-backed API変更時の検証

PostgreSQL repository、Doobie query、DB table/column、migration前提に触れた場合は、通常のapi testに加えてDB契約と該当Repositoryを実DBで確認する。

```sh
pnpm --dir ../momo-db db:up
pnpm --dir ../momo-db db:migrate
cd apps/api
sbt apiDbQuality
```

よく使うDB-backed API検証は、`apps/api` で以下のaliasから実行できる。

```sh
sbt apiDbQuality
```

`sbt test` では `Integration` tag付きのDB-backed specを除外する。検証結果を報告するときは、通常テストとは別に `apiDbQuality` で実行したspec名を明示する。DB未起動によりintegration testがskipされた場合は、DB動作は未検証として扱う。

CIのAPI workflowでは PostgreSQL service を起動し、`momo-db` をcheckoutしてmigrationを適用してから `sbt test` と `sbt apiDbQuality` を実行する。`momo-db` がprivate repositoryの場合は、読み取り権限を持つ `MOMO_DB_READ_TOKEN` secret を設定する。

ローカルでCI相当のAPIゲートをまとめて確認する場合は、PostgreSQL migration適用済み・Redis起動可能な状態で `apps/api` から `sbt apiFullCheck` を実行する。

### 4.2 Redis-backed API変更時の検証

Redis Streamsのwire動作や `RedisQueueProducer.resource` に触れた場合は、通常のapi testに加えて以下を実行する。

```sh
cd apps/api
sbt apiRedisQuality
```

`sbt test` では `Integration` tag付きのRedis外部接続テストを除外する。これにより、単体・in-memory中心の下位レベルテストはDocker/Redisの状態に依存しない。
