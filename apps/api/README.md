# momo-result API

Scala 3 / sbt / Tapir / http4s / Cats Effect による API サーバーです。HTTP 境界、認証、業務 usecase、画像一時保存、PostgreSQL・Redis Streams adapter を `apps/api` に実装しています。

## 実装範囲

- health check と OpenAPI 成果物生成
- Discord OAuth と開発用認証
- 試合・OCR ドラフト・OCR ジョブの API
- 画像アップロードと一時保存
- PostgreSQL repository、Redis Streams publisher

`openapi.yaml` は Tapir の endpoint 定義から生成される成果物です。手編集せず、生成後に差分を確認してください。

## 開発コマンド

```sh
cd apps/api
sbt apiCheck
sbt apiOpenApi
```

`apiCheck` は format、lint、compile、通常テストを実行します。PostgreSQL／Redis の wire 経路まで確認する場合は `sbt apiFullCheck` を使います。ローカル起動や個別ゲートの一覧は [`docs/dev-rule.md`](../../docs/dev-rule.md) を参照してください。

## 正本文書

実装規約・テスト方針・DB所有権・OCR queue 契約はルートの正本文書で管理します。

- [`docs/architecture.md`](../../docs/architecture.md)
- [`docs/test-rule.md`](../../docs/test-rule.md)
- [`docs/db-rule.md`](../../docs/db-rule.md)
- [`docs/redis-streams-ocr-contract.md`](../../docs/redis-streams-ocr-contract.md)

API の wire 契約は Tapir endpoint 定義と生成済み [`openapi.yaml`](openapi.yaml) を確認してください。
