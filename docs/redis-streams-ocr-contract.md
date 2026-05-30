# OCR Redis Streams Contract

目的: API と OCR worker の Redis Streams / outbox / ack 契約の正本。

読む条件:

- OCR queue payload、Redis stream、outbox、worker delivery / ack、OCR job lifecycle を変更する。
- API、worker、`momo-db` のいずれかで OCR配送境界に触る。

関連正本:

- JSON Schema: `docs/schemas/ocr-queue-payload-v1.schema.json`
- OCR hints schema: `docs/schemas/ocr-hints-v1.schema.json`
- DB schema / migration: `../momo-db`
- DB利用規約: `docs/db-rule.md`
- テスト規約: `docs/test-rule.md`

## 1. Ownership

| 契約 | Owner | 正本 |
|---|---|---|
| Redis Stream payload | API produces / worker consumes | この文書、JSON Schema、Scala/Python contract tests |
| Durable enqueue intent | API | `ocr_queue_outbox` |
| OCR job state | DB | `ocr_jobs` |
| OCR draft payload | worker writes / API reads | `ocr_drafts`, worker payload model |
| DB schema / migration | `momo-db` | `../momo-db` migrations |

Redis は配送路であり、ジョブ状態の正本ではない。worker は `jobId` からDBを確認し、DB状態に基づいて実行、破棄、または ack する。

## 2. Redis Topology

| 項目 | 既定値 | env |
|---|---|---|
| Job stream | `momo:ocr:jobs` | `OCR_REDIS_STREAM` |
| Consumer group | `momo-ocr-workers` | `OCR_REDIS_GROUP` |
| Dead-letter stream | `momo:ocr:jobs:dead` | `OCR_REDIS_DEAD_LETTER_STREAM` |
| Worker concurrency | `1` | `OCR_WORKER_CONCURRENCY` |
| Max delivery attempts | `1` | `OCR_MAX_ATTEMPTS` |
| Pending claim idle | `300000ms` | `OCR_REDIS_CLAIM_IDLE_SECONDS` |
| Worker blocking read | `30000ms` | `OCR_REDIS_BLOCK_SECONDS` |
| Outbox recovery poll | `1800s` | `OCR_OUTBOX_RECOVERY_INTERVAL_SECONDS` |
| Outbox due backlog admission limit | `24` | `OCR_OUTBOX_DUE_BACKLOG_LIMIT` |
| Outbox active backlog admission limit | `48` | `OCR_OUTBOX_ACTIVE_BACKLOG_LIMIT` |
| Oldest due outbox max delay | `600s` | `OCR_OUTBOX_OLDEST_DUE_MAX_DELAY_SECONDS` |
| Dead-letter backlog admission limit | `24` | `OCR_DEAD_LETTER_BACKLOG_LIMIT` |

`OCR_WORKER_CONCURRENCY` は1プロセス内の worker loop slot 数を表す。既定値は1。
2以上の場合、各 slot は DB 上の `worker_id` に `<OCR_WORKER_ID>-<slot>` を書く。
同一プロセス内の Redis pull は stale pending delivery の二重 claim を避けるため直列化し、
OCR実行とDB状態遷移は slot ごとに並行実行する。worker DB pool の `max_size` は
`OCR_WORKER_CONCURRENCY + 1` とし、追加の1接続は cancellation polling と重複配送確認の
headroom として使う。

Rules:

- API は `XADD` する。
- worker は `XGROUP CREATE ... MKSTREAM` を許容する。
- worker は `XREADGROUP` で新規配送を読み、stale PEL は `XCLAIM` する。
- 即時 nack は使わない。
- `OCR_TIMEOUT_SECONDS` はOCR認識timeout。`OCR_REDIS_CLAIM_IDLE_SECONDS` はPEL回収待機時間。混同しない。
- claim idle は、正当な長時間ジョブを重複配送しないよう API stale job reaper の基準値以上にする。
- worker の blocking read は、空 queue で Redis commands を増やしすぎないため長めに取る。メッセージ到着時は block 終了を待たずに返るため、通常の OCR 開始遅延にはしない。

## 3. Stream Payload v1

すべての Redis field value は string。JSON object、number、boolean を直接 field value にしない。

| Field | Required | Meaning |
|---|---:|---|
| `schemaVersion` | yes | `"1"` 固定 |
| `jobId` | yes | DB `ocr_jobs.id`。worker idempotency key |
| `draftId` | yes | DB `ocr_drafts.id` |
| `imageId` | yes | API 側の一時画像論理 ID |
| `imagePath` | yes | worker が読める `IMAGE_TMP_DIR` 配下の絶対パス |
| `requestedScreenType` | yes | `auto`, `total_assets`, `revenue`, `incident_log` |
| `attempt` | yes | payload schema 上の正整数。現行 producer は `1` 固定 |
| `enqueuedAt` | yes | ISO-8601 UTC timestamp |
| `ocrHintsJson` | no | compact / sorted keys / UTF-8 の JSON string。最大 8192 文字 |
| `requestId` | no | ログ相関 ID。`^[A-Za-z0-9_-]{1,64}$` |

Counters:

| Counter | Owner | Meaning |
|---|---|---|
| payload `attempt` | API | stream payload 上の値。現行は初回配送 `1` |
| `ocr_jobs.attempt_count` | worker | `queued -> running` claim 回数 |
| `ocr_queue_outbox.attempt_count` | API dispatcher | Redis publish 失敗回数 |
| Redis `times_delivered` | Redis | consumer group delivery 回数。DLQ判定に使う |

Schema rules:

- producer payload は閉じた契約として扱う。field 追加でも schema と両言語 contract tests を同時に更新する。
- worker runtime 境界でも stream payload schema を適用する。
- `ocrHintsJson` がある場合は JSON parse 後に hints schema も適用する。
- schema validation 後の parser は型変換と runtime 境界条件（絶対 `imagePath` など）を担当する。

## 4. OCR Hints

`ocrHintsJson` は省略可能な JSON object を string 化した Redis field。API は null を落とし、key をソートし、空白なしで出力する。

worker は hints を補助情報として扱う。画面種別、プレイヤー名、結果値の正本として扱わない。

互換性:

- optional field 追加は後方互換。
- 既存 field の型変更・削除は非互換。

上限:

| Field | Limit |
|---|---|
| `gameTitle`, `layoutFamily` | 1-64 chars |
| `knownPlayerAliases` | max 4 |
| `knownPlayerAliases[].memberId` | 1-128 chars |
| `knownPlayerAliases[].aliases` | 1-8 items, each 1-64 chars |
| `computerPlayerAliases` | max 8 items, each 1-64 chars |

## 5. API Outbox

API は OCR job 作成 transaction 内で `ocr_drafts`、`ocr_jobs`、`ocr_queue_outbox` を作成する。DB commit 後、通常経路では作成した outbox 行を即時 claim して `XADD` を試みる。HTTP success は Redis publish 完了ではなく、DB に durable enqueue intent が残ったことを意味する。即時 publish に失敗した場合は outbox 行を backoff 後の `PENDING` へ戻す。outbox recovery dispatcher は低頻度に残りの `PENDING` / stale `IN_FLIGHT` を再配送する。

API は OCR job / draft / outbox 作成前に admission guard を実行する。Redis ping 失敗、due `PENDING` + expired `IN_FLIGHT` backlog 超過、`PENDING` + `IN_FLIGHT` active backlog 超過、oldest due outbox 遅延超過、dead-letter stream length 超過のいずれかでは、DB row を作らず `503 SERVICE_UNAVAILABLE` Problem Details で fail-fast する。閾値は通常利用（週1開催、1開催4〜6試合、担当者1人が試合後都度OCR）を妨げない初期値として設定し、env で変更可能にする。

Lifecycle:

```text
PENDING -> IN_FLIGHT -> DELIVERED
                 \-> PENDING (publish failure / retry)
```

Rules:

- `ocr_queue_outbox.stream_payload` は Stream Payload v1 object。`jobId` だけから再構築しない。
- `requestId` と OCR hints は API request 時点の値を保持する。
- API の即時 publish は作成した `PENDING` 行を id 指定で claim する。
- recovery dispatcher は due `PENDING` と expired `IN_FLIGHT` を `FOR UPDATE SKIP LOCKED` で claim する。
- `XADD` 成功後に `DELIVERED`, `redis_message_id`, `delivered_at` を記録する。
- `XADD` 失敗時は秘密情報を含まない error class だけを `last_error` に記録し、backoff 後の `PENDING` に戻す。

## 6. Worker Delivery / Ack

原則: terminal DB write before `XACK`。`succeeded`, `failed`, `cancelled` の永続化前に ack しない。

Ack exceptions:

| 状態 | worker動作 |
|---|---|
| unknown `jobId` | DB正本に存在しない残骸として ack して破棄 |
| already terminal | 再実行せず ack |
| already running | 他workerの実行権を尊重し、再実行も失敗書き込みもせず ack |
| queued 確認後に別workerが先に running claim | already running と同じ扱いにし、再実行も失敗書き込みもせず ack |
| malformed payload with readable `jobId` | `QUEUE_FAILURE` を terminal failure としてDBに書いてから ack |
| malformed payload and failure write failed | ack せず PEL claim / DLQ に任せる |
| max attempts exceeded with readable `jobId` | `QUEUE_FAILURE` を terminal failure としてDBに書き、DLQへ `XADD` してから元messageを ack |
| max attempts exceeded and failure write failed | DLQ/ack せず PEL claim に任せる |
| max attempts exceeded without readable `jobId` | DLQへ `XADD` してから元messageを ack |

Worker rules:

- stale running job の terminal failure 化は API maintenance が担う。
- worker は `imagePath` を `IMAGE_TMP_DIR` 配下へ解決できる場合だけ読み、3MB上限を再検証する。
- API は queued job の cancel 要求だけを行う。running 中の即時中断は MVP では best-effort。

Allowed job transitions:

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> cancelled
queued -> failed
queued -> cancelled
```

終端状態からの遷移は禁止。

## 7. DB Contracts

- `ocr_jobs` は job lifecycle の正本。worker は `SELECT ... FOR UPDATE` 相当で現状を確認し、`queued -> running` claim 時に `attempt_count` を増やす。
- 成功時は `ocr_drafts` upsert と `ocr_jobs` terminal transition を同一 transaction にする。
- `ocr_drafts.payload_json`, `warnings_json`, `timings_ms_json` は worker の OCR domain model を JSON 化した値。
- 1 job につき最大1 draft。ack 前 crash の再処理では同じ `job_id` を upsert する。
- `ocr_queue_outbox` は Redis publish intent の正本。DB schema 変更は `momo-db` migration と consumer 側検証を揃える。
- Redis publish は at-least-once。`XADD` 成功後に `DELIVERED` 更新が失敗すると recovery で再 publish され得る。worker は `ocr_jobs` の状態確認により terminal / running job を再実行せず ack する。

## 8. Compatibility

後方互換:

- Redis payload optional field 追加。ただし schema と contract tests を同時更新する。
- `ocrHintsJson` optional field 追加。ただし hints schema と contract tests を同時更新する。
- DB nullable column または default 付き column 追加。
- 新しい warning code 追加。API は未知 warning を透過表示する。

非互換:

- required field の削除・rename。
- 既存 field の型、意味、単位変更。
- `requestedScreenType`, `FailureCode`, job status の既存値削除。
- ack 前後関係、DB正本性、terminal transition 条件変更。

非互換変更は API、worker、`momo-db` の deploy 順序を明示し、JSON Schema と両言語 contract tests を同じ PR で更新する。

## 9. Required Tests

Redis contract に触れた場合:

```sh
cd apps/api
sbt testOnly momo.api.repositories.OcrQueuePayloadSpec
sbt testOnly momo.api.usecases.OcrQueueOutboxDispatcherSpec
sbt apiRedisQuality
sbt apiDbQuality
```

```sh
cd apps/ocr-worker
uv run pytest tests/unit/features/test_queue_contract.py
uv run pytest tests/unit/features/test_redis_consumer.py
uv run pytest -m integration tests/integration/test_redis_stream_consumer.py
```

Schema 変更では、Scala/Python の serializer 出力を `docs/schemas/` の JSON Schema で検証するテストを同じ変更で更新・実行する。

DB schema に触れた場合は `docs/db-rule.md` と `docs/test-rule.md` に従い、`momo-db` migration 適用済み Testcontainers PostgreSQL で検証する。

## 10. Operations

障害調査で見るもの:

- API `/healthz/details` の Redis status。
- `ocr_queue_outbox` の `PENDING`, `IN_FLIGHT`, `FAILED` 件数と oldest `next_attempt_at`。
- Redis stream length、consumer group pending count、DLQ stream length。
- `jobId` による API log、worker log、`ocr_jobs`、`ocr_queue_outbox` の横断検索。

ログに出さないもの:

- 画像内容
- OCR raw text 全文
- session / CSRF / OAuth token
- Redis URL / DB URL
