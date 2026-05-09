# OCR Redis Streams Contract

この文書は、API と OCR worker の Redis Streams 契約の正本である。`apps/api`、
`apps/ocr-worker`、`momo-db` のいずれで変更する場合も、この文書と契約テストを先に確認する。

## 1. Scope and Ownership

| 領域 | Owner | 正本 |
|---|---|---|
| Redis Stream payload | API produces / worker consumes | この文書、`OcrQueuePayload`, `queue_contract.py` |
| Durable enqueue intent | API | `ocr_queue_outbox` in `momo-db`, API repository tests |
| OCR job state | DB | `ocr_jobs` |
| OCR draft payload | worker writes / API reads | `ocr_drafts`, worker payload models |
| DB schema / migration | `momo-db` | `../momo-db` migrations |

Redis は配送路であり、ジョブ状態の正本ではない。worker は必ず `jobId` から DB を確認し、DB 状態に基づいて実行、破棄、または ack する。

## 2. Redis Topology

| 項目 | 既定値 | 設定 |
|---|---|---|
| Job stream | `momo:ocr:jobs` | `OCR_REDIS_STREAM` |
| Consumer group | `momo-ocr-workers` | `OCR_REDIS_GROUP` |
| Dead-letter stream | `momo:ocr:jobs:dead` | `OCR_REDIS_DEAD_LETTER_STREAM` |
| Worker concurrency | `1` | `OCR_WORKER_CONCURRENCY` |
| Worker max delivery attempts | `1` | `OCR_MAX_ATTEMPTS` |
| Pending claim idle | `OCR_TIMEOUT_SECONDS * 1000ms` | `OCR_TIMEOUT_SECONDS` |

API は `XADD` する。worker は `XGROUP CREATE ... MKSTREAM` を許容し、`XREADGROUP` で新規配送を読み、stale PEL は `XCLAIM` する。即時 nack は使わない。

## 3. Stream Payload v1

すべての Redis field は string である。JSON object、number、boolean を直接 field value にしない。

| Field | Required | Meaning |
|---|---:|---|
| `jobId` | yes | DB `ocr_jobs.id`。worker の idempotency key |
| `draftId` | yes | DB `ocr_drafts.id` |
| `imageId` | yes | API 側の一時画像論理 ID |
| `imagePath` | yes | worker が読める絶対パス |
| `requestedImageType` | yes | `auto`, `total_assets`, `revenue`, `incident_log` |
| `attempt` | yes | API が payload 作成時に入れる正整数。現行実装では常に `1` |
| `enqueuedAt` | yes | API が payload を作成した ISO-8601 UTC timestamp |
| `ocrHintsJson` | no | compact / sorted keys / UTF-8 の JSON string |
| `requestId` | no | ログ相関用 ID。`^[A-Za-z0-9_-]{1,64}$` のみ許容 |

`attempt`、`ocr_jobs.attempt_count`、`ocr_queue_outbox.attempt_count`、Redis `times_delivered` は別概念である。

| Counter | Owner | Meaning |
|---|---|---|
| payload `attempt` | API | stream payload schema 上の値。現在は初回配送 `1` 固定 |
| `ocr_jobs.attempt_count` | worker | OCR 実行 claim 回数。`queued -> running` で increment |
| `ocr_queue_outbox.attempt_count` | API dispatcher | Redis publish 試行失敗回数 |
| Redis `times_delivered` | Redis | consumer group delivery 回数。DLQ 判定に使用 |

JSON Schema は `docs/schemas/ocr-queue-payload-v1.schema.json` を正本とする。契約テストは各言語の serializer 出力をこの schema で検証する。worker の `parse_job_message` は runtime 境界でも stream payload schema を適用し、`ocrHintsJson` がある場合は JSON parse 後に `docs/schemas/ocr-hints-v1.schema.json` も適用する。schema validation 後の parser は型変換と、絶対 `imagePath` など JSON Schema だけで表しにくい runtime 境界条件を担当する。

schema は producer payload を閉じた契約として扱うため、Redis payload field を追加する場合は schema と Scala/Python の契約テスト、worker parser を同じ変更で更新する。

## 4. `ocrHintsJson`

`ocrHintsJson` は省略可能な JSON object を string 化した field である。API は null を落とし、key をソートし、空白なしで出力する。

```json
{
  "gameTitle": "桃鉄2",
  "layoutFamily": "momotetsu_2",
  "knownPlayerAliases": [
    { "memberId": "member-ponta", "aliases": ["ぽんた", "ぽんた社長"] }
  ],
  "computerPlayerAliases": ["さくま", "さくま社長"]
}
```

worker は hint を補助情報として扱う。画面種別、プレイヤー名、結果値の正本として扱わない。未知 field の追加は後方互換であり、既存 field の型変更・削除は非互換である。

`ocrHintsJson` は Redis field 上では string なので、トップレベル schema では JSON string であることだけを検証する。内容は `ocrHintsJson` を JSON parse したうえで `docs/schemas/ocr-hints-v1.schema.json` に対して検証する。

## 5. API Durable Outbox

API は OCR job 作成 transaction 内で `ocr_drafts`、`ocr_jobs`、`ocr_queue_outbox` を作成する。HTTP request の成功は Redis publish 完了ではなく、DB に durable enqueue intent が残ったことを意味する。

`ocr_queue_outbox` lifecycle:

```text
PENDING -> IN_FLIGHT -> DELIVERED
                 \-> PENDING (publish failure / retry)
```

`ocr_queue_outbox.stream_payload` は Stream Payload v1 の object である。`jobId` だけから再構築しない。`requestId` と OCR hints は API request 時点の値を保持する必要がある。

Dispatcher invariants:

- `claimDue` は due `PENDING` と expired `IN_FLIGHT` を `FOR UPDATE SKIP LOCKED` で claim する。
- `XADD` 成功後に `DELIVERED`, `redis_message_id`, `delivered_at` を記録する。
- `XADD` 失敗時は秘密情報を含まない error class だけを `last_error` に記録し、backoff 後の `PENDING` に戻す。

## 6. Worker Delivery and Ack

worker invariants:

- Terminal DB write before `XACK`。`succeeded`, `failed`, `cancelled` の永続化前に ack しない。
- Unknown `jobId` は DB 正本に存在しない残骸として ack して破棄する。
- Already terminal `jobId` は再実行せず ack して破棄する。
- Malformed payload は `jobId` が読める場合、`QUEUE_FAILURE` として DB に terminal failure を書いてから ack する。
- Terminal failure の DB 書き込みに失敗した場合は ack せず、PEL claim / DLQ に任せる。
- `OCR_MAX_ATTEMPTS` を超えた stale pending delivery は DLQ へ `XADD` してから元 message を ack する。

worker が実行できる状態遷移:

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> cancelled
queued -> failed
queued -> cancelled
```

終端状態からの遷移は禁止する。API は queued job の cancel 要求だけを行い、running 中の即時中断は MVP では best-effort とする。

## 7. DB Contracts

`ocr_jobs` は job lifecycle の正本である。worker は `SELECT ... FOR UPDATE` 相当で現状を確認し、`queued -> running` claim 時に `attempt_count` を増やす。成功時は `ocr_drafts` upsert と `ocr_jobs` terminal transition を同一 transaction にする。

`ocr_drafts` は worker の解析結果を保持する。`payload_json`、`warnings_json`、`timings_ms_json` は worker の OCR domain model を JSON 化した値である。1 job につき最大1 draft とし、ack 前 crash の再処理では同じ `job_id` を upsert する。

`ocr_queue_outbox` は Redis publish intent の正本である。DB schema の追加・変更はこのリポジトリで直接行わず、`momo-db` migration と consumer 側検証を揃える。

## 8. Compatibility Rules

後方互換:

- Redis payload に optional field を追加する。ただし producer の正本 schema は閉じているため、schema と契約テストを同時に更新する。
- `ocrHintsJson` に optional field を追加する。ただし hints schema と契約テストを同時に更新する。
- DB に nullable column または default 付き column を追加する。
- 新しい warning code を追加し、API が未知 warning を透過表示する。

非互換:

- 必須 field の削除または rename。
- 既存 field の型、意味、単位の変更。
- `requestedImageType`, `FailureCode`, job status の既存値削除。
- ack 前後関係、DB 正本性、terminal transition 条件の変更。

非互換変更は API、worker、`momo-db` の deploy 順序を明示し、JSON Schema と両言語の契約テストを同じ PR で更新する。

## 9. Required Tests

Redis contract に触れた場合:

- API payload: `sbt testOnly momo.api.repositories.OcrQueuePayloadSpec`
- API outbox dispatcher: `sbt testOnly momo.api.usecases.OcrQueueOutboxDispatcherSpec`
- API Redis wire: `sbt apiRedisQuality`
- API DB outbox: `sbt apiDbQuality`
- Worker payload parser: `uv run pytest tests/unit/features/test_queue_contract.py`
- Worker Redis consumer: `uv run pytest tests/unit/features/test_redis_consumer.py`
- Worker Redis integration: `uv run pytest tests/integration/test_redis_stream_consumer.py`

`OcrQueuePayloadSpec` と `test_queue_contract.py` は `docs/schemas/` の JSON Schema を読み、serializer 出力を検証する。schema 変更は両方のテストを同じ PR で更新・実行する。

DB schema に触れた場合は `docs/db-rule.md` と `docs/test-rule.md` に従い、`momo-db` migration 適用済み Testcontainers Postgres で検証する。

## 10. Operations Checklist

障害調査では次を確認する。

- API `/healthz/details` の Redis status。
- `ocr_queue_outbox` の `PENDING`, `IN_FLIGHT`, `FAILED` 件数と oldest `next_attempt_at`。
- Redis stream length、consumer group pending count、DLQ stream length。
- `jobId` で API log、worker log、`ocr_jobs`、`ocr_queue_outbox` を横断検索する。
- ログには画像内容、OCR raw text 全文、session/CSRF/OAuth token、Redis URL、DB URL を出さない。
