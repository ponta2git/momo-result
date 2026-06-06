# 開発作業規約

目的: toolchain、ローカル起動、検証コマンド、Git運用の正本。

読む条件:

- 開発環境を起動する。
- 変更範囲に対して実行する quality gate を選ぶ。
- Git branch / commit / PR を作る。

参照:

- テスト選択とoracle: `docs/test-rule.md`
- coverage / CI artifact: `docs/test-architecture.md`
- DB所有権と migration: `docs/db-rule.md`
- Redis/OCR queue 契約: `docs/redis-streams-ocr-contract.md`

## 1. Toolchain

| 領域 | ツール |
|---|---|
| web | Node.js 24, pnpm 10.10.0 |
| api | Java 25, sbt 1.12 系 |
| ocr-worker | Python 3.14, uv |
| integration | Docker / Testcontainers |
| OCR runtime | Tesseract 5+ |

バージョンの正本は設定ファイルとCI workflowにある。この表は作業開始時の目安であり、差分があれば実装設定を正とする。

## 2. Environment

- ローカル secret は `.env` に置き、コミットしない。
- 必要なキー名は `.env.example` を参照する。
- Scala API と Python worker は root `.env` を自動読み込みしない。起動前に shell へ読み込む。
- Web の `VITE_*` も、root `.env` を使う場合は同じ shell で読み込んでから起動する。
- 本番 secret は `fly secrets`、CI secret は GitHub Actions secrets で管理する。
- `MOMO_LOG_FORMAT=json` は本番向け1行JSON、`MOMO_LOG_FORMAT=text` はローカル向け。
- DB integration をローカルで実行する場合、`momo-db` の migration が取得済みで、対象DBに適用されることを確認する。

## 3. Local Run

依存サービス:

```sh
docker compose up -d
pnpm --dir ../momo-db db:up
pnpm --dir ../momo-db db:migrate
```

API:

```sh
set -a; source .env; set +a
cd apps/api && sbt run
```

OCR worker:

```sh
set -a; source .env; set +a
uv run --directory apps/ocr-worker momo-ocr worker
```

Web:

```sh
pnpm web:dev
```

ローカルの `pnpm web:e2e` は Postgres / Redis Testcontainers とE2E専用APIを起動する隔離gateであり、普段使いのローカルDB/Redisへ接続しない。既に起動済みのruntime containerやCIのruntime smoke対象へPlaywrightだけを当てる場合は `pnpm web:e2e:target` を使い、接続先のDB/Redisが検証用に隔離されていることを確認する。

## 4. Standard Commands

### Root

| 目的 | コマンド |
|---|---|
| web dev | `pnpm web:dev` |
| web build | `pnpm web:build` |
| web lint | `pnpm web:lint` |
| web e2e isolated | `pnpm web:e2e` |
| web e2e target | `pnpm web:e2e:target` |
| web test | `pnpm web:test` |
| web coverage report | `pnpm web:test:coverage:report` |
| web typecheck | `pnpm web:typecheck` |
| api format | `pnpm api:format` |
| api format check | `pnpm api:format:check` |
| api lint | `pnpm api:lint` |
| api quality | `pnpm api:quality` |
| api test | `pnpm api:test` |
| api coverage | `pnpm api:coverage` |
| api coverage report | `pnpm api:coverage:report` |
| GitHub Actions lint | `pnpm actionlint` |
| public safety | `pnpm public:safety:check` |

### Web

```sh
cd apps/web
pnpm generate:api
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:coverage
pnpm test:coverage:report
pnpm build
pnpm e2e
pnpm e2e:target
```

`format:check` は oxfmt、`lint` は oxlint と web architecture/API contract checks を実行する。`typecheck`、`lint`、`test:run`、coverage report の前には API 型生成が走る。

### API

```sh
cd apps/api
sbt apiFormatCheck
sbt apiLint
sbt apiQuality
sbt test
sbt apiCoverage
sbt apiCoverageReportOnly
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
uv run pytest --cov=momo_ocr --cov-report=xml:coverage.xml --cov-report=json:coverage.json --cov-report=html:htmlcov --cov-fail-under=0
uv run pytest -m integration
```

通常の `uv run pytest` は `integration` marker を除外する。Redis / PostgreSQL / native OCR / tessdata などの外部runtimeを検証したと言うには、`uv run pytest -m integration` が必要。

## 5. Change Gates

| 変更 | 必須ゲート |
|---|---|
| web production code | `pnpm --filter web format:check`, `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web test:run` |
| web API DTO / generated type | `pnpm --filter web generate:api`, `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web test:run` |
| web build/runtime config | web production code gate + `pnpm --filter web build` |
| ログイン後主要UX / UI flow | web production code gate + `pnpm web:e2e` |
| api endpoint / OpenAPI | `sbt apiQuality`, `sbt test`; 必要なら web `generate:api` |
| api usecase / domain / codec | `sbt apiQuality`, `sbt test`; coverage対象なら `sbt apiCoverage` |
| PostgreSQL repository / DB前提 | api gate + `sbt apiDbQuality` |
| Redis Streams / OCR queue | api gate + `sbt apiRedisQuality` |
| ocr-worker production code | `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy`, `uv run pytest` |
| ocr-worker external runtime | ocr-worker production gate + `uv run pytest -m integration` |
| Docker/Fly/runtime config | `pnpm public:safety:check`, `docker build`, `scripts/ci/runtime-smoke.sh`, container image scan、必要なら `pnpm web:e2e:target` |
| coverage対象ロジック | 各領域の coverage gate |
| docs only | `git diff --check`, `pnpm public:safety:check` |

外部依存 gate を skip / 未実行にした場合、その外部 wire 動作は未検証として報告する。

## 6. CI Gates

現行CIの代表:

| Workflow | 実行内容 |
|---|---|
| `.github/workflows/public-safety.yml` | public repository safety check |
| `.github/workflows/web.yml` | API型生成差分、format、lint、typecheck、Vitest、coverage report、build |
| `.github/workflows/api.yml` | format、lint、clean compile、OpenAPI check、test、DB/Redis quality、coverage report |
| `.github/workflows/ocr-worker.yml` | ruff format/check、mypy、pytest、coverage report、integration test |
| `.github/workflows/deploy.yml` | runtime config check、momo-db migration適用、Docker build、image scan、runtime smoke、Playwright target smoke、Fly deploy |

`deploy.yml` の production deploy 経路では、サブシステム quality gate、public safety、runtime image build / scan / smoke を可能な範囲で並列に進め、`release-ready` で合流させる。report-only coverage はPRレビュー補助の扱いとし、deploy 経由の release gate では待たない。

CIの詳細なtimeout、サービス、artifact path は workflow を正とする。docs へ値を写す場合は、判断に必要な粒度だけに留める。

## 7. Git

- branch: `<type>/<short-description>`
- type: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`
- commit: `<type>: <概要>`
- PR は小さく保ち、merge 前に変更範囲の gate を通す。
- squash merge を基本とする。
