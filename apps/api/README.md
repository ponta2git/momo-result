# momo-result API

Scala 3 / sbt / Tapir / http4s / Cats Effect による API サーバーです。

## 現在の実装範囲

- `GET /healthz`
- `GET /openapi.yaml`
- 開発用スタブ認証 `X-Momo-Account-Id`
- 開発用 CSRF `X-CSRF-Token: dev`
- 一時画像保存（PNG/JPEG/WebP、3MB上限、4K寸法上限、マジックバイト・コンテナ検証）
- OCRジョブ作成、取得、キャンセル
- OCRドラフト取得
- インメモリ / PostgreSQL の repository adapter
- Redis Streams キュープロデューサ

Discord OAuth、PostgreSQL、Redis Streams の本番 adapter を含みます。

CIでは stale class 起因のハングを避けるため、`clean Test/compile` を実行してからテストします。Cats Effect 系のMUnitテストは共通 `MomoCatsEffectSuite` で30秒タイムアウトを設定しています。

## 開発コマンド

```sh
cd apps/api
sbt compile
sbt test
sbt apiOpenApi
sbt apiOpenApiCheck
```

`apiOpenApi` は Tapir のエンドポイント定義から `openapi.yaml` を生成します。現時点では JSON 形式で出力しています（JSON は YAML 1.2 としても有効です）。

### 品質ゲート（format / lint / compile / test）

| alias | 内容 |
|---|---|
| `apiFormat` | scalafmt で全ソースを整形 |
| `apiFormatCheck` | scalafmt の差分があれば失敗 |
| `apiLint` | scalafix を `--check` で実行（差分があれば失敗） |
| `apiFix` | scalafix を適用して書き換え |
| `apiQuality` | `apiFormatCheck → apiLint → Test/compile → apiOpenApiCheck` |
| `apiCheck` | `apiQuality` に加えて、外部サービス依存を除く `test` まで実行する通常ゲート |
| `apiCoverage` | scoverage で unit / non-integration test の C1 と branch coverage baseline を検証 |
| `apiDbQuality` | Testcontainers Postgres に momo-db migration を適用して PostgreSQL-backed integration spec を実行するDBゲート |
| `apiRedisQuality` | Testcontainers Redis で Redis Streams の wire integration spec を実行するRedisゲート |
| `apiFullCheck` | `apiCheck`、`apiDbQuality`、`apiRedisQuality` を順に実行するローカル完全ゲート |

PRを出す前にローカルで `sbt apiCheck` が通ることを確認してください。DB/Redis 経路に触れた場合、または CI 相当の確認をしたい場合は、Docker/Testcontainers 利用可能な状態で `sbt apiFullCheck` を実行してください。DB ゲートは momo-db migration 適用済みの Testcontainers Postgres、Redis ゲートは Testcontainers Redis を使います。

### テストレベル

API テストは、値オブジェクト・codec・usecase の軽量テストを厚めに置き、HTTP では認証/CSRF/Problem Details/DTO境界を代表経路に絞って確認します。PostgreSQL/Redis の wire 動作は `Integration` に加えて `DbIntegration` / `RedisIntegration` tag を付け、通常の `sbt test` から分離します。DB spec は `momo.api.integration` の `Postgres*Spec` と `DbContractSpec`、Redis spec は `momo.api.integration.redis` に置き、品質ゲートは class/package pattern と tag で対象を発見します。

`apiCoverage` は手書きの domain / usecase / HTTP 境界 / in-memory repository adapter / codec / queue payload を対象に、現在の C1 / branch coverage baseline を下回らないことを検証します。PostgreSQL / Redis の wire adapter は DB/Redis integration ゲートで検証します。C2 は coverage tool だけで保証せず、複合条件を持つロジックでは独立因子と期待される外部契約を table-driven test で固定します。

Repository adapter のうち本番 adapter と in-memory adapter の両方を持つものは、重要な共有挙動を `momo.api.repositories.contract` の契約テストに寄せます。実装固有の SQL、transaction、index 前提、Redis wire だけを DB/Redis 統合 spec に置きます。

Usecase / domain / HTTP 境界は in-memory repository と実 DTO/codec を使う Detroit 寄りのテストを基本にします。外部副作用、失敗注入、ログ観測、固定時刻など London 寄りの確認が必要な場合は `momo.api.testing.TestDoubles` の typed double を使い、spec 内で副作用付き匿名 double を量産しません。

通常の `sbt test` は並列実行されるため、各テストは実行順に依存しない前提で書きます。外部サービス、固定 writable `/tmp`、module-scope mutable state、実時間 sleep / wall clock は通常テストに持ち込まず、一時ディレクトリは `MomoCatsEffectSuite.tempDirectory`、DB/Redis wire 動作は `apiDbQuality` / `apiRedisQuality` に分離します。

### コーディング規約（lint / scalac で強制）

- Scala 3 新構文へ自動変換（`rewrite.scala3.convertToNewSyntax`）
- 改行コードは LF 固定（`.editorconfig` と `.scalafmt.conf`）
- `-language:strictEquality` により異なる型の `==` / `!=` はコンパイルエラー
- `-Werror` + `-Wunused:all` + `-Wvalue-discard` + `-Wnonunit-statement` + `-Wsafe-init` + `-Wimplausible-patterns` + `-Xverify-signatures`
- scalafix で禁止: `var` / `throw` / `return` / `null` / `asInstanceOf` / `isInstanceOf` / `finalize` / セミコロン / タブ / XML / `val` パターン / デフォルト引数
- 正規表現禁止: `println` / `System.out|err` / `Thread.sleep` / `scala.concurrent.Await` / `unsafeRun*` / `TODO`・`FIXME` のチケット番号無し記述
- import は scalafix `OrganizeImports` で自動整列（java → scala → 3rd party → `momo`）

どうしても上記ルールから外れる正当な事情がある場合は、最小スコープで scalafix の suppression を付けます:

```scala
// 行単位
val foo = unsafeBlock() // scalafix:ok DisableSyntax.noUnsafeRunSync

// 範囲
// scalafix:off DisableSyntax.noUnsafeRunSync
beforeAll { initIo.unsafeRunSync() }
afterAll { teardownIo.unsafeRunSync() }
// scalafix:on DisableSyntax.noUnsafeRunSync
```

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `APP_ENV` | `dev` | `dev` / `test` / `prod` |
| `HTTP_HOST` | `0.0.0.0` | bind host |
| `HTTP_PORT` | `8080` | bind port |
| `IMAGE_TMP_DIR` | 一時ディレクトリ配下の共有パス | OCR Worker と共有する一時画像ディレクトリ |
| `DEV_MEMBER_IDS` | 開発用メンバーIDのカンマ区切り | 試合参加者として許可する固定4名の `member_*` ID |
| `READ_API_RATE_LIMIT_PER_MINUTE` | `120` | OCR status / OCR draft / matches list の account 別 read API rate limit |
| `EXPORT_RATE_LIMIT_PER_MINUTE` | `30` | scope指定CSV/TSV export の account 別 rate limit |
| `EXPORT_ALL_RATE_LIMIT_PER_MINUTE` | `6` | 全件CSV/TSV export の account 別 rate limit |
| `EXPORT_MAX_ROWS` | `20000` | 同期CSV/TSV export の最大明細行数 |
| `EXPORT_MAX_BYTES` | `16777216` | 同期CSV/TSV export の最大レスポンスbytes |
| `OCR_OUTBOX_RECOVERY_INTERVAL_SECONDS` | `1800` | Redis publish の即時配送に失敗した OCR outbox を再配送する低頻度 recovery 間隔 |
| `OCR_REDIS_DEAD_LETTER_STREAM` | `momo:ocr:jobs:dead` | OCR worker が配送失敗を退避する dead-letter stream |
| `OCR_OUTBOX_DUE_BACKLOG_LIMIT` | `24` | due `PENDING` + expired `IN_FLIGHT` outbox がこの件数を超えたら OCR 新規受付を一時停止 |
| `OCR_OUTBOX_ACTIVE_BACKLOG_LIMIT` | `48` | `PENDING` + `IN_FLIGHT` outbox がこの件数を超えたら OCR 新規受付を一時停止 |
| `OCR_OUTBOX_OLDEST_DUE_MAX_DELAY_SECONDS` | `600` | oldest due outbox がこの秒数を超えて遅延したら OCR 新規受付を一時停止 |
| `OCR_DEAD_LETTER_BACKLOG_LIMIT` | `24` | dead-letter stream length がこの件数を超えたら OCR 新規受付を一時停止 |
| `STALE_OCR_JOB_REAPER_INTERVAL_SECONDS` | `1800` | stale OCR job を失敗化する maintenance 間隔 |

`APP_ENV=prod` では開発用認証は拒否されます。

## ローカル起動

```sh
cd apps/api
APP_ENV=dev DEV_MEMBER_IDS=member_ponta,member_akane_mami,member_otaka,member_eu sbt run
```

例:

```sh
curl http://localhost:8080/healthz
curl -H 'X-Momo-Account-Id: account_ponta' http://localhost:8080/api/auth/me
```

Mutation 系 API は `X-Momo-Account-Id` と `X-CSRF-Token: dev` が必要です。

## OCR Worker との契約

Redis Streams へ投入するフィールドは `../../docs/redis-streams-ocr-contract.md` に従います。
Scala側では `OcrQueuePayloadSpec` で `../../docs/schemas/` の JSON Schema に対して以下を固定しています。

- 全フィールドは文字列
- 必須キー: `schemaVersion`, `jobId`, `draftId`, `imageId`, `imagePath`, `requestedScreenType`, `attempt`, `enqueuedAt`
- `schemaVersion` は Stream Payload v1 では `"1"` 固定
- `ocrHintsJson` は compact / sorted keys / UTF-8 の JSON 文字列。最大 8192 文字で、内容は hints schema の上限に従う
- `requestId` は任意のログ相関 field

画像は OCR 完了までの一時保存のみを想定し、恒久保存しません。
