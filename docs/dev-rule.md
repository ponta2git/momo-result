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

### 1.3 ローカルDB・Redis起動

Docker Compose でPostgreSQL と Redis のみ起動する。

```sh
docker compose up -d
```

DBマイグレーションは `momo-db` リポジトリ側で管理する（`docs/db-rule.md` 参照）。

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

起動順序の依存: `docker compose up -d`（Redis）→ api → ocr-worker → web

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
| ocr-worker format | `uv run ruff format --check .` | `apps/ocr-worker` |
| ocr-worker lint | `uv run ruff check .` | `apps/ocr-worker` |
| ocr-worker test | `uv run pytest` | `apps/ocr-worker` |

既存のスクリプトやMakefileがある場合はそちらを優先する。
