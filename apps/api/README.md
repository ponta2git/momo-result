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

## 開発コマンド

```sh
cd apps/api
sbt compile
sbt test
sbt apiOpenApi
sbt apiOpenApiCheck
```

`apiOpenApi` は Tapir のエンドポイント定義から `openapi.yaml` を生成します。現時点では JSON 形式で出力しています（JSON は YAML 1.2 としても有効です）。

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

Redis Streams へ投入するフィールドは `apps/ocr-worker/docs/api-contract.md` に従います。
Scala側では `OcrStreamPayloadSpec` で以下を固定しています。

- 全フィールドは文字列
- 必須キー: `jobId`, `draftId`, `imageId`, `imagePath`, `requestedImageType`, `attempt`, `enqueuedAt`
- `ocrHintsJson` は compact / sorted keys / UTF-8 の JSON 文字列

画像は OCR 完了までの一時保存のみを想定し、恒久保存しません。
