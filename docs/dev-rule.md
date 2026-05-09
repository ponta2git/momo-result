# 開発作業規約

この文書はローカル起動、検証コマンド、Git運用の正本である。DB所有権は `docs/db-rule.md`、テスト選択は `docs/test-rule.md` を参照する。

## 1. 必要ツール

| ツール | 目安 | 用途 |
|---|---|---|
| Node.js | CI は 24 | web |
| pnpm | 10.10.0 | workspace / web |
| Java | 21 | api |
| sbt | 1.12 系 | api |
| Python | 3.12 | ocr-worker |
| uv | lockfile 対応版 | ocr-worker |
| Docker | Testcontainers 対応 | DB/Redis integration |
| Tesseract | 5+ | OCR |

## 2. 環境変数

- ローカルは `.env` を使う。コミットしない。
- 必要なキー名は `.env.example` を参照する。
- Scala API と Python worker は `.env` を自動読み込みしない。root の `.env` を shell に読み込んでから起動する。
- Web で root `.env` の `VITE_*` を使う場合も、同じ shell で `.env` を読み込んでから `pnpm dev` する。
- 本番 secrets は `fly secrets`、CI secrets は GitHub Actions secrets で管理する。
- `MOMO_LOG_FORMAT=json` は本番向け1行JSON、`MOMO_LOG_FORMAT=text` はローカル向け。

## 3. ローカル起動

Redis はこのリポジトリの compose で起動する。

```sh
docker compose up -d
```

PostgreSQL と migration は `../momo-db` 側で管理する。

```sh
pnpm --dir ../momo-db db:up
pnpm --dir ../momo-db db:migrate
```

起動順序:

1. Redis: `docker compose up -d`
2. PostgreSQL: `pnpm --dir ../momo-db db:up`
3. migration: `pnpm --dir ../momo-db db:migrate`
4. API: `set -a; source .env; set +a; cd apps/api && sbt run`
5. OCR worker: `set -a; source .env; set +a; uv run --directory apps/ocr-worker momo-ocr worker`
6. Web: `cd apps/web && pnpm dev`

root からの web 起動は `pnpm web:dev` でもよい。

## 4. 標準検証コマンド

### root

| 目的 | コマンド |
|---|---|
| web dev | `pnpm web:dev` |
| web build | `pnpm web:build` |
| web test | `pnpm web:test` |
| web typecheck | `pnpm web:typecheck` |
| api quality | `pnpm api:quality` |
| api test | `pnpm api:test` |

### web (`apps/web`)

| 目的 | コマンド |
|---|---|
| OpenAPI型生成 | `pnpm generate:api` |
| format | `pnpm format:check` |
| lint | `pnpm lint` |
| typecheck | `pnpm typecheck` |
| test | `pnpm test:run` |
| build | `pnpm build` |

### api (`apps/api`)

| 目的 | コマンド |
|---|---|
| format | `sbt apiFormatCheck` |
| lint | `sbt apiLint` |
| compile + OpenAPI | `sbt apiQuality` |
| unit / non-integration test | `sbt test` |
| DB integration | `sbt apiDbQuality` |
| Redis integration | `sbt apiRedisQuality` |
| full local gate | `sbt apiFullCheck` |

`sbt test` は `Integration` tag と `momo.api.integration.*` を除外する。DB/Redis の wire 動作は `apiDbQuality` / `apiRedisQuality` で明示的に実行する。

### ocr-worker (`apps/ocr-worker`)

| 目的 | コマンド |
|---|---|
| format | `uv run ruff format --check .` |
| lint | `uv run ruff check .` |
| typecheck | `uv run mypy` |
| test | `uv run pytest` |

## 5. 変更別ゲート

- web 変更: `generate:api` が関係する場合は先に実行し、`format:check`、`lint`、`typecheck`、`test:run`、必要なら `build`。
- api endpoint / OpenAPI 変更: `apiQuality`（OpenAPI生成確認を含む）、`test` 後に web の `generate:api`。
- PostgreSQL repository / migration 前提の変更: `apiDbQuality` を追加し、実行した spec 名を報告する。
- Redis Streams / OCR queue 変更: `apiRedisQuality` を追加する。
- ocr-worker 変更: `ruff format --check`、`ruff check`、`mypy`、`pytest`。Docker-backed integration に依存する失敗は未検証として扱わない。

CI の API / OCR worker は `momo-db` を checkout し、`MOMO_DB_MIGRATIONS_DIR` で migration ディレクトリを指定する。ローカルで兄弟 repo がない場合も同 env で `drizzle/` を指定できる。

## 6. Git

- ブランチ名: `<type>/<short-description>`。type は `feat` / `fix` / `refactor` / `test` / `chore` / `docs`。
- コミットメッセージ: `<type>: <概要>`。
- PR は小さく保つ。
- merge 前に該当領域の format / lint / typecheck / test を通す。
- squash merge を基本とする。
