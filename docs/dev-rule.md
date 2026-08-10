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
| web | Node.js 24, pnpm 10.34.5 |
| api | Java 25, sbt 1.12 系 |
| ocr-worker | Python 3.14, uv |
| analysis-worker | Rust 1.97, Cargo; local runtime は Docker/Linux |
| integration | Docker / Testcontainers |
| OCR runtime | Tesseract 5+ |

バージョンの正本は設定ファイルとCI workflowにある。この表は作業開始時の目安であり、差分があれば実装設定を正とする。

## 2. Environment

- ローカル secret は `.env` に置き、コミットしない。
- 必要なキー名は `.env.example` を参照する。
- Scala API、Python worker、Rust analysis worker は root `.env` を自動読み込みしない。起動前に
  shellへ読み込むか、必要な変数だけを専用の非追跡env fileへ置く。
- root の `pnpm dev` は API 起動用に root `.env` を読み込む。
- Web の `VITE_*` も、root `.env` を使う場合は同じ shell で読み込んでから起動する。
- analysis workerのローカルコンテナにはroot `.env` 全体を渡さない。DB / Redis接続とworker専用設定だけを
  `private/analysis-worker.local.env` などの非追跡fileへ置き、OAuth secret等をコンテナへ伝播させない。
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

API + Web（推奨）:

```sh
pnpm dev
```

`pnpm dev` は shell / root `.env` の `DATABASE_URL` を優先し、未設定時は sibling `momo-db/.env.local` の `DIRECT_URL` をローカルDB設定として利用する。永続DB設定が見つからない場合や、API health が database `ok` にならない場合は Web を起動せず終了する。これにより、DB未接続の空状態を登録データ0件として誤表示しない。
設定済みDBへ接続できない場合は、ランチャーが待機を続けず `momo-db` の起動・migrationコマンドを案内する。

`momo-db` の通常の `db:down` はnamed volumeを保持する。ローカル業務データを持つcompose projectに
`docker compose down -v` を実行しない。PostgreSQL major version、compose project名、volume名、mount先を
変更すると、旧volumeのデータは新volumeへ自動移行されない。起動後に業務データが0件に見える場合は書込みを
続けず、`docker inspect`で実際のmountを確認し、旧volumeを削除せずに論理backup / restoreで現行migration適用済み
DBへ移す。旧PostgreSQL data directoryを異なるmajor versionのserverへ直接mountしない。

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

Analysis worker:

`pnpm dev` はanalysis workerを起動しない。workerのprocess isolation契約はLinux専用であり、macOSで
`momo-analysis worker` を直接起動するとjob claim前にfail closedする。ローカルでは専用imageをbuildし、
別terminalからDockerで起動する。

```sh
docker build \
  --file apps/analysis-worker/Dockerfile \
  --tag momo-analysis-worker:local \
  .

docker run --rm \
  --name momo-analysis-local \
  --memory 256m \
  --memory-swap 256m \
  --add-host host.docker.internal:host-gateway \
  --env-file private/analysis-worker.local.env \
  momo-analysis-worker:local
```

worker imageの更新だけでは、DBに保存されたdesired algorithm versionは変わらない。`ALGORITHM_VERSION` を更新した
直後や、旧versionをseedしたローカルDBで新しいworkerを初めて使う場合は、workerとAPI readerのreadyを確認してから
release昇格をdry-run、applyの順で行う。同じoperation keyを両方に使い、key内のversionと日付は対象ごとに更新する。

```sh
docker exec momo-analysis-local momo-analysis release-promote \
  --trigger algorithm-update \
  --operation-key local-algorithm-v3-20260810

docker exec momo-analysis-local momo-analysis release-promote \
  --trigger algorithm-update \
  --operation-key local-algorithm-v3-20260810 \
  --apply
```

applyは全登録作品のversion付きcampaignを作り、既存のqueued jobがあれば同じjobへ最新版を集約する。DB rowを直接
書き換えたり、worker起動時に自動昇格したりしない。管理画面が待機中のままでworker logがready以降進まない場合は、
DB正本のjob version、fresh worker capability、`analysis_delivery_deferred` の順に確認する。

`--memory` と `--memory-swap` を同値にしてswapを許可せず、現行runtime定義と同じworker全体256MiB上限にする。
Docker Desktop上のコンテナからホストのDB / Redisへ接続するため、専用env fileの接続先hostは
`host.docker.internal`とする。URL値は文書、shell history、tracked fileへ書かない。

専用env fileは少なくとも `DATABASE_URL`、`MOMO_ANALYSIS_READ_DATABASE_URL`、`REDIS_URL`、
`MOMO_ANALYSIS_PUBLICATION_MODE=enabled` と、`WorkerRuntimeConfig` が要求するmemory、timeout、一時領域、
Redis stream / group、worker ID、config version、lease / heartbeat設定を持つ。ローカル既定値は
`scripts/ci/analysis-worker-control-plane-smoke.sh` の `worker_environment` と整合させ、worker IDとconsumer groupは
ローカル専用の一意な値にする。Fly用設定はpublicationが既定でdisabledなので、そのままローカル実行設定として
使わない。

API起動後に管理者メニューの手動再計算、または試合結果確定でjobを発火する。worker logの
`analysis worker is ready`、`analysis attempt claimed`、`analysis attempt completed` と、管理画面のjob履歴、
戦績比較画面の計算中から成果物表示への遷移を確認する。foreground実行をCtrl-Cで停止したときはdraining完了後に
`--rm`でコンテナが削除される。

Web:

```sh
pnpm web:dev
```

ローカルの `pnpm web:e2e` は Postgres / Redis Testcontainers とE2E専用APIを起動する隔離gateであり、普段使いのローカルDB/Redisへ接続しない。既に起動済みのruntime containerやCIのruntime smoke対象へPlaywrightだけを当てる場合は `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8080 pnpm web:e2e:runtime` を使い、Vite dev server ではなくruntime containerのビルド済みwebを検証する。runtime containerをE2E用に起動する場合は `IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT=100` と `IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES=1` を `scripts/ci/start-runtime-container.sh` に渡し、ホストの一時ディスク使用率で画像upload smokeが落ちないようにする。任意の検証用targetへPlaywrightを当てる場合は `pnpm web:e2e:target` を使い、接続先のDB/Redisが検証用に隔離されていることを確認する。

## 4. Standard Commands

### Root

| 目的 | コマンド |
|---|---|
| API + Web dev | `pnpm dev` |
| local dev launcher test | `pnpm dev:launcher:test` |
| web dev | `pnpm web:dev` |
| web build | `pnpm web:build` |
| web lint | `pnpm web:lint` |
| web e2e isolated | `pnpm web:e2e` |
| web e2e target | `pnpm web:e2e:target` |
| web e2e runtime | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8080 pnpm web:e2e:runtime` |
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
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8080 pnpm e2e:runtime
```

`format:check` は oxfmt、`lint` は oxlint、web architecture/API/UI consistency checks、production TS/TSX module size check を実行する。`typecheck`、`lint`、`test:run`、coverage report の前には API 型生成が走る。

`pnpm --filter web lint:react-perf` は React props / JSX 生成の探索用 signal として使う。現時点では CI gate に入れず、警告数の削減自体を目的にしない。警告が集中する page、table、card、metric section は、責務分割、stable handler、presentational component 境界の見直し候補として扱う。

### API

```sh
cd apps/api
sbt apiFormatCheck
sbt apiLint
sbt apiQuality
sbt test
sbt apiCoverage
sbt apiCoverageReportOnly
sbt apiTestWithCoverageReportOnly
sbt apiDbQuality
sbt apiRedisQuality
sbt apiFullCheck
```

`sbt test` は integration を除外する。CI report mode では `apiTestWithCoverageReportOnly` が通常テストの代わりに coverage artifact を生成し、`apiCoverageReportOnly` は単体実行向けに `clean` から始める。DB/Redis wire 動作は `apiDbQuality` / `apiRedisQuality` で明示的に実行する。

### OCR Worker

```sh
cd apps/ocr-worker
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest
uv run pytest --cov
uv run pytest --cov --cov-report=xml:coverage.xml --cov-report=json:coverage.json --cov-report=html:htmlcov --cov-fail-under=0
uv run pytest -m integration
```

通常の `uv run pytest` は `integration` marker を除外する。Redis / PostgreSQL / native OCR / tessdata などの外部runtimeを検証したと言うには、`uv run pytest -m integration` が必要。

### Analysis Worker

```sh
cd apps/analysis-worker
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets --all-features
cargo build --locked --workspace --release
```

Rust / Clippy lintの正本は `apps/analysis-worker/Cargo.toml` とする。rustc warning、`unsafe_code`、
Clippy `all` / `pedantic` / `nursery` をdenyし、panicし得るindex、unchecked cast、`unwrap` / `expect`、
診断sourceの破棄、理由のない抑制などは選択したrestriction lintで追加禁止する。`restriction` group全体は
相互に矛盾するlintを含むため一括有効化しない。lint例外は対象式またはtest moduleへ最小化した
`#[expect(..., reason = "...")]` とし、production codeに `#[allow(...)]` を置かない。version付き数値計算で
浮動小数点の演算順を保つ例外は、algorithm versionとgolden checksumを維持する理由を明記する。

productionのOS FFIは `process` moduleだけに隔離し、外側へcheckedなsafe APIとRAII guardを公開する。
固定要素数の分析モデルはenum、array、const genericsで表し、動的長collectionとruntime indexを必要な境界へ
限定する。純粋coreとruntime shellの逆依存を禁止し、testを含むRust moduleは900行以内をarchitecture testで
固定する。超過前に計算pipeline、metrics、publication、recovery、codecなど責務名の付くsubmoduleへ分割する。

PostgreSQL / Redis / Linux process境界は通常のCargo testと分け、repository rootで次を実行する。

```sh
scripts/ci/analysis-release-db-smoke.sh apps/analysis-worker/target/release/momo-analysis
scripts/ci/analysis-worker-control-plane-smoke.sh apps/analysis-worker/target/release/momo-analysis
scripts/ci/analysis-worker-image-smoke.sh <local-image-tag>
```

先頭2 commandはmigration適用済みPostgreSQLを必要とし、control-plane smokeはRedisも必要とする。
これらのsmokeはfixtureを永続化するため、普段使いのローカルDB / Redisへ向けず、CI serviceまたは明示的に隔離した
一時PostgreSQL / Redisだけで実行する。通常のローカルデータに対するE2E確認は前節の専用workerコンテナと
管理者メニューを使う。
resource / endurance測定は本番同等runtimeのprivate gateであり、通常CIの成功を代用証拠にしない。

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
| analysis-worker production code | `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`, `cargo test --locked --workspace --all-targets --all-features`, `cargo build --locked --workspace --release` |
| analysis-worker algorithm version | analysis-worker production gate + release DB smoke + control-plane smoke。ローカルDBは互換性dry-run後にrelease昇格 |
| analysis-worker DB / Redis / process | analysis-worker production gate + release DB smoke + control-plane smoke + dedicated image smoke |
| Docker/Fly/runtime config | `pnpm public:safety:check`, `docker build`, `scripts/ci/runtime-smoke.sh`, container image scan、必要なら `pnpm web:e2e:runtime` |
| coverage対象ロジック | 各領域の coverage gate |
| docs only | `git diff --check`, `pnpm public:safety:check` |

外部依存 gate を skip / 未実行にした場合、その外部 wire 動作は未検証として報告する。

## 6. CI Gates

現行CIの代表:

| Workflow | 実行内容 |
|---|---|
| `.github/workflows/public-safety.yml` | public repository safety check |
| `.github/workflows/web.yml` | format、API型生成を含むlint、typecheck、Vitestまたはcoverage付きVitest、build |
| `.github/workflows/api.yml` | format、lint、clean compile、OpenAPI check、testまたはcoverage付きtest、DB/Redis quality |
| `.github/workflows/ocr-worker.yml` | ruff format/check、mypy、pytestまたはcoverage付きpytest、integration test |
| `.github/workflows/analysis-worker.yml` | Cargo format / Clippy / test / release build、DB / Redis control-plane smoke、専用image build / scan / hard-limit smoke |
| `.github/workflows/deploy.yml` | runtime config check、momo-db migration適用、Docker build、image scan、runtime smoke、Playwright runtime E2E smoke、Fly deploy |

`deploy.yml` の production deploy 経路では、サブシステム quality gate、public safety、runtime image build / scan / smoke を可能な範囲で並列に進め、`release-ready` で合流させる。サブシステム workflow の `report_coverage` はPRレビュー補助の扱いとし、production deploy から呼ぶ場合は無効にして release gate では待たない。`report_coverage` が有効な場合、同じテスト集合の通常実行は省き、coverage付きテストをその gate とする。

CIの詳細なtimeout、サービス、artifact path は workflow を正とする。docs へ値を写す場合は、判断に必要な粒度だけに留める。

## 6.1 Production rollback verification

本番コードのrollbackでは、pipelineの成功とincident mitigationの完了を同じ意味で扱わない。

- rollback対象のcommitと、実際に稼働するartifactのidentityを記録・照合する。
- 対象機能をユーザーが触る経路と、その経路が呼ぶAPI / usecase / engineを先に列挙し、rollback差分が全経路を覆うことを確認する。
- deploy後はprocess healthだけでなく、変更対象の代表的な画面・APIの応答とログを確認する。
- 高負荷・性能障害では、deploy success、health check、機能応答、CPU / latencyなどの外部観測を別々の証拠として扱う。取得できない観測は未検証と報告する。
- machineが停止・suspend中でruntime観測ができない場合、コードの配置成功までは確認できても、性能回復やincident解消とは判定しない。

## 7. Git

- branch: `<type>/<short-description>`
- type: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`
- commit: `<type>: <概要>`
- PR は小さく保ち、merge 前に変更範囲の gate を通す。
- squash merge を基本とする。
