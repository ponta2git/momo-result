# 2026-05-14 Web Architecture Remediation Handoff

## 対象

- `apps/api`
- `apps/ocr-worker`

## apps/api への申し送り

### 1. Idempotency conflict を機械可読 code に分ける

web は以下の code を優先して解釈する実装に更新済み。

- `IDEMPOTENCY_IN_PROGRESS`
- `IDEMPOTENCY_PAYLOAD_MISMATCH`

現状の `CONFLICT` / `IDEMPOTENCY_CONFLICT` + `detail` 文字列判定は fallback として残している。API 側は同じ 409 でも、処理中と payload mismatch を `ProblemDetails.code` で分けること。

### 2. OpenAPI 生成を web quality gate の前提にした

web の `build` / `typecheck` / `test:run` / `lint` は `generate:api` を前段で実行する。API DTO や `ProblemDetails.code` を変更した場合は、`apps/api/openapi.yaml` を正として更新すれば web 側の型生成に反映される。

### 3. Idempotency-Key は frontend 呼び出し側で明示必須にした

web の API wrapper は idempotency が必要な mutation で `idempotencyKey` を必須にした。API 側は従来どおり key + canonical payload hash の同一性を維持すること。

### 4. frontend の idempotency auto 生成経路を廃止した

web の低レベル `apiRequest` は `idempotency: "auto"` と `idempotencyKey` 直指定を受け付けない。mutation は `runIdempotentMutation` / `runIdempotentOperationAttempt` 経由で operation 名と payload fingerprint を必ず持つ。API 側は `Idempotency-Key` 欠落時のエラー仕様を維持し、同じ operation payload の retry と payload mismatch を区別できるようにしておくこと。

### 5. master の displayOrder は暫定的に web の pending list 長で送っている

作品・マップ・シーズン作成時の `displayOrder` 相当の意図は、web では pending list の末尾追加としてしか扱えない。API 側で display order が domain 上の整合性を持つ場合は、将来的に「末尾追加」などの intent を受け取り、採番・競合解決を backend transaction 内へ寄せること。

## apps/ocr-worker への申し送り

### 1. 事件簿名の順序と表記

web は事件簿の key / 表示名 / OCR 名を shared domain 定義へ集約した。OCR payload の `players[].incidents` は引き続き次の日本語名を期待する。

- `目的地`
- `プラス駅`
- `マイナス駅`
- `カード駅`
- `カード売り場`
- `スリの銀次`

worker 側で incident 名や順序を変える場合は、API schema / web shared domain / worker parser を同時に更新すること。

### 2. 収益 OCR の重複 member 解決

web は revenue payload 内で同じ member に解決される行が複数ある場合、最初の行を採用し warning を表示する。worker 側で重複を検出できる場合は、`warnings` に原因を入れると UI 上の確認理由が明確になる。

### 3. ScoreGrid は incident key の shared domain 定義を直接参照する

web の score grid は desktop / mobile とも `shared/domain/incidents` の列定義を参照する。worker 側の incident payload が増減・改名される場合は、API schema と web shared domain を同時に更新すること。
