# momo-result API

Scala 3 / sbt / Tapir / http4s / Cats Effect による API サーバーです。

## 現在の実装範囲

- `GET /healthz`
- `GET /openapi.yaml`
- 開発用スタブ認証 `X-Dev-User`
- 開発用 CSRF `X-CSRF-Token: dev`
- 一時画像保存（PNG/JPEG/WebP、3MB上限、マジックバイト検証）
- OCRジョブ作成、取得、キャンセル
- OCRドラフト取得
- インメモリのジョブ・ドラフト・キュープロデューサ

Discord OAuth、PostgreSQL/Redis の本物アダプタは次フェーズで実装します。

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
| `apiDbQuality` | Testcontainers Postgres に momo-db migration を適用して PostgreSQL-backed integration spec を実行するDBゲート |
| `apiRedisQuality` | Testcontainers Redis で Redis Streams の wire integration spec を実行するRedisゲート |
| `apiFullCheck` | `apiCheck`、`apiDbQuality`、`apiRedisQuality` を順に実行するローカル完全ゲート |

PRを出す前にローカルで `sbt apiCheck` が通ることを確認してください。DB/Redis 経路に触れた場合、または CI 相当の確認をしたい場合は、Docker/Testcontainers 利用可能な状態で `sbt apiFullCheck` を実行してください。DB ゲートは momo-db migration 適用済みの Testcontainers Postgres、Redis ゲートは Testcontainers Redis を使います。

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
| `IMAGE_TMP_DIR` | `/tmp/momo-result/uploads` | OCR Worker と共有する一時画像ディレクトリ |
| `DEV_MEMBER_IDS` | `ponta,akane-mami,otaka,eu` 相当 | 開発用ログイン可能ID（固定4名: ぽんた / あかねまみ / おーたか / いーゆー） |

`APP_ENV=prod` では開発用認証は拒否されます。

## ローカル起動

```sh
cd apps/api
APP_ENV=dev DEV_MEMBER_IDS=ponta,akane-mami,otaka,eu sbt run
```

例:

```sh
curl http://localhost:8080/healthz
curl -H 'X-Dev-User: ponta' http://localhost:8080/api/auth/me
```

Mutation 系 API は `X-Dev-User` と `X-CSRF-Token: dev` が必要です。

## OCR Worker との契約

Redis Streams へ投入するフィールドは `../../docs/redis-streams-ocr-contract.md` に従います。
Scala側では `OcrQueuePayloadSpec` で `../../docs/schemas/` の JSON Schema に対して以下を固定しています。

- 全フィールドは文字列
- 必須キー: `jobId`, `draftId`, `imageId`, `imagePath`, `requestedImageType`, `attempt`, `enqueuedAt`
- `ocrHintsJson` は compact / sorted keys / UTF-8 の JSON 文字列
- `requestId` は任意のログ相関 field

画像は OCR 完了までの一時保存のみを想定し、恒久保存しません。
