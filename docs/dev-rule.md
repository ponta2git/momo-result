# 開発作業規約

目的: ローカル起動、検証コマンド、Git運用の正本。

読む条件:

- 開発環境を起動する。
- 変更範囲に対して実行する quality gate を選ぶ。
- Git branch / commit / PR を作る。

判断:

- テスト選択は `docs/test-rule.md`。
- DB所有権と migration は `docs/db-rule.md`。

## 1. Toolchain

| 領域 | ツール |
|---|---|
| web | Node.js 24, pnpm 10.10.0 |
| api | Java 25, sbt 1.12 系 |
| ocr-worker | Python 3.14, uv |
| integration | Docker / Testcontainers |
| OCR runtime | Tesseract 5+ |

## 2. Environment

- ローカル secret は `.env` に置き、コミットしない。
- 必要なキー名は `.env.example` を参照する。
- Scala API と Python worker は root `.env` を自動読み込みしない。起動前に shell へ読み込む。
- Web の `VITE_*` も、root `.env` を使う場合は同じ shell で読み込んでから起動する。
- 本番 secret は `fly secrets`、CI secret は GitHub Actions secrets で管理する。
- `MOMO_LOG_FORMAT=json` は本番向け1行JSON、`MOMO_LOG_FORMAT=text` はローカル向け。

## 3. Local Run

```sh
docker compose up -d
pnpm --dir ../momo-db db:up
pnpm --dir ../momo-db db:migrate
```

```sh
set -a; source .env; set +a
cd apps/api && sbt run
```

```sh
set -a; source .env; set +a
uv run --directory apps/ocr-worker momo-ocr worker
```

```sh
pnpm web:dev
```

## 4. Standard Commands

### Root

| 目的 | コマンド |
|---|---|
| web dev | `pnpm web:dev` |
| web build | `pnpm web:build` |
| web lint | `pnpm web:lint` |
| web test | `pnpm web:test` |
| web typecheck | `pnpm web:typecheck` |
| api quality | `pnpm api:quality` |
| api test | `pnpm api:test` |
| api coverage | `pnpm api:coverage` |

### Web

```sh
cd apps/web
pnpm generate:api
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:coverage
pnpm build
```

### API

```sh
cd apps/api
sbt apiQuality
sbt test
sbt apiCoverage
sbt apiDbQuality
sbt apiRedisQuality
sbt apiFullCheck
```

`sbt test` は integration を除外する。DB/Redis wire 動作は `apiDbQuality` / `apiRedisQuality` で明示的に実行する。

### OCR Worker

```sh
cd apps/ocr-worker
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest
uv run pytest --cov=momo_ocr --cov-report=term-missing:skip-covered
uv run pytest -m integration
```

## 5. Change Gates

| 変更 | 必須ゲート |
|---|---|
| web production code | `format:check`, `lint`, `typecheck`, `test:run` |
| web API DTO / generated type | `generate:api`, `lint`, `typecheck`, `test:run` |
| web build/runtime config | 上記 + `build` |
| api endpoint / OpenAPI | `apiQuality`, `test`; 必要なら web `generate:api` |
| api usecase / domain / codec | `apiQuality`, `test`; C1/C2対象なら `apiCoverage` |
| PostgreSQL repository / DB前提 | 上記 + `apiDbQuality` |
| Redis Streams / OCR queue | 上記 + `apiRedisQuality` |
| ocr-worker production code | ruff format, ruff check, mypy, pytest |
| ocr-worker external runtime | 上記 + `pytest -m integration` |
| coverage対象ロジック | 各領域の coverage gate |
| docs only | `git diff --check` |

外部依存 gate を skip / 未実行にした場合、その外部 wire 動作は未検証として報告する。

## 6. Git

- branch: `<type>/<short-description>`
- type: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`
- commit: `<type>: <概要>`
- PR は小さく保ち、merge 前に変更範囲の gate を通す。
- squash merge を基本とする。
