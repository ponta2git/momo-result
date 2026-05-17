# 2026-05-13 API Architecture Remediation Handoff

## 対象

- `apps/web`

## web への申し送り

### 1. 公開 API レスポンスから `imagePath` が削除された

対象レスポンス:

- `UploadImageResponse`
- `OcrJobResponse`

内容:

- API はローカルファイルパスを公開しない方針へ変更された。
- `imageId`, `mediaType`, `sizeBytes` は引き続き利用可能。

対応方法:

- `apps/web` で `imagePath` を参照している箇所があれば削除する。
- 画像参照が必要な UI は、既存の source image API や `imageId` ベースの取得 API を使う。
- 型生成や OpenAPI client を使っている場合は `apps/api/openapi.yaml` から再生成する。

### 2. OCR screen type の JSON field 名が変わった

変更:

- 旧: `requestedImageType`, `detectedImageType`
- 新: `requestedScreenType`, `detectedScreenType`

内容:

- HTTP request / response DTO は「画像種別」ではなく「OCR対象画面種別」として表現する。
- 互換 field は残していない。

対応方法:

- web の OCR job 作成 payload を `requestedScreenType` に更新する。
- OCR job / draft response の参照を `requestedScreenType`, `detectedScreenType` に更新する。
- API client / OpenAPI 型を再生成する。

### 3. 開発・テスト用の認証ヘッダ名が変わった

変更:

- 旧: `X-Dev-User`
- 新: `X-Momo-Account-Id`

内容:

- Production では外部から送られた account header は破棄され、検証済み session から内部注入される。
- Dev/Test では `X-Momo-Account-Id: account_ponta` のように指定する。
- 旧 `X-Dev-User` は受け付けない。

対応方法:

- web の dev proxy、API client、E2E、手元確認 curl は必ず `X-Momo-Account-Id` に更新する。
- mutation 系は引き続き `X-CSRF-Token: dev` も送る。
- OpenAPI client を再生成し、header 名の変更を反映する。

### 4. mutation request 全体に body size limit が入った

内容:

- upload 以外の `POST` / `PUT` / `PATCH` / `DELETE` にも `REQUEST_MAX_BYTES` 上限が適用される。
- 既定値は 256 KiB。
- 超過時は `413 PAYLOAD_TOO_LARGE` が返る。
- upload は従来どおり `UPLOAD_REQUEST_MAX_BYTES` の大きい上限を使う。

対応方法:

- web は `413` を validation/error UI として扱えるようにする。
- 大きい JSON payload を送る画面がある場合は、不要 field の削減か API 分割を検討する。

### 5. `Idempotency-Key` の競合挙動が厳格化された

内容:

- 同じ key + 同じ payload の完了済み request は replay される。
- 同じ key + 同じ payload が処理中の場合は `409 CONFLICT`。
- 同じ key + 異なる payload は `409 CONFLICT`。
- mutation が validation 失敗などで `Left` を返した場合、予約は破棄される。

対応方法:

- web は retry 時に同一 mutation/payload へ同一 key を再利用する。
- 処理中の `409` は少し待って同一 key で再試行するか、ユーザーに「処理中」と表示する。
- payload を変えた再送では新しい key を発行する。
