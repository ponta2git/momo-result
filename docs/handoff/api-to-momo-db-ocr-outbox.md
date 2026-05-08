# API → momo-db 申し送り（OCR enqueue durable outbox）

作成日: 2026-05-08

`apps/api` 側で OCR job 作成まわりの境界契約・エラーハンドリングを改善した。DB schema が必要な残タスクを `momo-db` 側に引き継ぐ。

追記: 2026-05-08 時点で `momo-db` 側の `ocr_queue_outbox` migration は local 適用済み。`apps/api` 側も outbox insert / dispatcher / DB contract test まで追従済み。

---

## 1. 背景

今回 `apps/api` では以下を実装済み。

- `ocr_drafts` / `ocr_jobs` / `match_drafts` への OCR artifact 添付を 1 DB transaction にまとめた。
- Redis Streams への publish 失敗を `503 DEPENDENCY_FAILED` として返し、補償処理失敗もログに残すようにした。
- HTTP 境界で未捕捉の DB / queue 例外を ProblemDetails に正規化した。
- `Idempotency-Key` の保存失敗をログ化した。

ただし、現在の構成では **DB commit 後、Redis `XADD` 前に API process が落ちた場合**、`ocr_jobs.status = queued` の job が DB に残る一方で Redis Stream に message が存在しない可能性が残る。

この穴は `apps/api` だけでは完全には閉じられない。momo-db に DB-backed outbox table を追加し、OCR enqueue を DB transaction の一部として永続化する必要がある。

---

## 2. 必須対応

### 2.1 `ocr_queue_outbox` table を追加する

既存の `discord_outbox` と同じ考え方で、Redis Streams への publish intent を DB に永続化する。

推奨 table 名:

- `ocr_queue_outbox`

推奨 columns:

| column | 型 | 必須 | 用途 |
|---|---:|---:|---|
| `id` | `text` | yes | outbox row id |
| `job_id` | `text` | yes | `ocr_jobs.id`。1 job 1 enqueue intent |
| `dedupe_key` | `text` | yes | 同一 intent の重複防止。基本は `ocr-job:<job_id>` |
| `stream_payload` | `jsonb` | yes | Redis Stream に送る key/value payload |
| `status` | `text` | yes | `PENDING` / `IN_FLIGHT` / `DELIVERED` / `FAILED` |
| `attempt_count` | `integer` | yes | publish 試行回数。default `0` |
| `last_error` | `text` | no | 最後の publish 失敗理由。秘密情報を入れない |
| `claim_expires_at` | `timestamptz` | no | dispatcher crash 時の reclaim 用 |
| `next_attempt_at` | `timestamptz` | yes | retry/backoff 用。default `now()` |
| `delivered_at` | `timestamptz` | no | Redis `XADD` 成功時刻 |
| `redis_message_id` | `text` | no | Redis Stream が返した message id |
| `created_at` | `timestamptz` | yes | default `now()` |
| `updated_at` | `timestamptz` | yes | default `now()` |

推奨制約:

- `job_id` は `ocr_jobs(id)` への FK を張る。
- `stream_payload` は `jsonb_typeof(stream_payload) = 'object'`。
- `status` は上記 4 値の CHECK。
- `attempt_count >= 0` の CHECK。
- `dedupe_key` は active status で partial unique。
  - `status IN ('PENDING','IN_FLIGHT','DELIVERED')`
  - `FAILED` は dead letter として残せるようにする。

推奨 indexes:

- `idx_ocr_queue_outbox_status_next` on `(status, next_attempt_at)`
- `idx_ocr_queue_outbox_job_id` on `(job_id)`
- `uq_ocr_queue_outbox_dedupe_active` partial unique on `(dedupe_key)` where active

### 2.2 `stream_payload` の contract

`stream_payload` は `apps/api` の `OcrQueuePayload` / `apps/ocr-worker` の `queue_contract.py` と同じ field を保持する。

必須 keys:

- `jobId`
- `draftId`
- `imageId`
- `imagePath`
- `requestedImageType`
- `attempt`
- `enqueuedAt`

任意 keys:

- `ocrHintsJson`
- `requestId`

重要:

- OCR worker の Redis queue contract は変更しない。
- DB outbox は Redis Stream に送る payload を保持するだけにする。
- `requestId` や OCR hints は API request 時点の値を保持する必要があるため、`job_id` だけから再構築する設計にはしない。

---

## 3. 期待する後続実装

### 3.1 apps/api

momo-db migration 適用後、API 側で以下を実装する。

1. OCR job 作成 transaction に `ocr_queue_outbox` insert を追加する。
2. Redis publish は outbox row を claim してから実行する。
3. `XADD` 成功時に `DELIVERED` / `redis_message_id` / `delivered_at` を更新する。
4. publish 失敗時は `PENDING` に戻して `next_attempt_at` と `last_error` を更新する。
5. retry 上限または運用上の deadline 超過時だけ `FAILED` にし、`ocr_jobs` / `match_drafts` を失敗状態へ遷移させる。

これにより、API process が DB commit 後に落ちても outbox row が残り、dispatcher / reconciler が再 publish できる。

### 3.2 apps/ocr-worker

Redis Stream payload が変わらない限り、OCR worker 側の変更は原則不要。

必要になる可能性があるのは、重複 delivery に対する再確認だけ。

- Redis Streams は元々 at-least-once 前提。
- worker 側は `jobId` を正本にし、すでに `running` / `succeeded` / `failed` / `cancelled` の job を不用意に再実行しないこと。

---

## 4. migration / deploy 順序

後方互換な新規 table 追加なので、既存 API / worker を止めずに入れられる。

1. `momo-db` に `ocr_queue_outbox` schema と migration を追加する。
2. `pnpm --dir ../momo-db db:generate`
3. `pnpm --dir ../momo-db db:check`
4. `pnpm --dir ../momo-db build`
5. migration を適用する。
6. `apps/api` 側で outbox 利用実装を入れる。
7. `apps/api` の DB contract / repository integration test で table contract を検証する。

注意:

- consumer deploy 前に momo-db migration が適用済みであることを確認する。
- 既存 table への column 追加ではなく新規 table のため、基本的に rewrite risk はない。
- index は新規 table 上なので通常作成でよい。大量 backfill は不要。

---

## 5. 検証観点

momo-db 側:

- `ocr_queue_outbox` の CHECK / partial unique / index が生成されている。
- `stream_payload` に object 以外を入れられない。
- 同じ `dedupe_key` の active row を二重作成できない。
- `FAILED` row は dead letter として残せ、同じ intent の再作成方針を明示できる。

apps/api 側:

- OCR job 作成 transaction に outbox insert が含まれる。
- `match_drafts` 添付失敗時は `ocr_drafts` / `ocr_jobs` / `ocr_queue_outbox` がすべて rollback される。
- DB commit 後、Redis publish 前に dispatcher が落ちても `PENDING` row から再 publish できる。
- Redis publish 失敗で user response / logs / outbox status が整合する。

apps/ocr-worker 側:

- outbox 経由で publish された Redis payload を既存 contract で parse できる。
- 重複 delivery 時に job 状態を見て二重実行しない。

---

## 6. 関連する保留事項

### 6.1 `idempotency_keys` expired row cleanup

今回 API 側で `Idempotency-Key` 保存失敗のログ化を入れた。DB schema は既に `idempotency_keys.expires_at` と index を持っている。

別件だが、運用上は期限切れ row cleanup が必要。

推奨:

```sql
DELETE FROM idempotency_keys
WHERE expires_at < now();
```

これは OCR outbox と独立して実施可能。cron / scheduled job / 手動運用のいずれにするかを momo-db または運用側で決める。

---

## 7. 参照

- `docs/db-rule.md`
- `docs/post-mortem/lessons.md`
- `apps/api/src/main/scala/momo/api/repositories/OcrQueuePayload.scala`
- `apps/ocr-worker/src/momo_ocr/features/ocr_jobs/queue_contract.py`
- `../momo-db/src/schema.ts` の `discord_outbox`
