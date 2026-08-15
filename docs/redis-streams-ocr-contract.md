# OCR Redis Streams Contract

目的: API と Processing Worker内のOCR Worker roleの Redis Streams / outbox / ack 契約の正本。

読む条件:

- OCR queue payload、Redis stream、outbox、OCR Worker roleのdelivery / ack、OCR job lifecycle を変更する。
- API、Processing Worker、`momo-db` のいずれかでOCR配送境界に触る。

関連正本:

- JSON Schema: `docs/schemas/ocr-queue-payload-v2.schema.json`
- OCR hints schema: `docs/schemas/ocr-hints-v1.schema.json`
- DB schema / migration: `../momo-db`
- DB利用規約: `docs/db-rule.md`
- テスト規約: `docs/test-rule.md`

## 1. Ownership

| 契約 | Owner | 正本 |
|---|---|---|
| Redis Stream payload v2 | API produces / Rust OCR Worker role consumes | この文書、v2 JSON Schema、Scala / Rust contract tests |
| Durable enqueue intent | API | `ocr_queue_outbox` |
| OCR job state | DB | `ocr_jobs` |
| OCR draft payload | processing parent process writes / API reads | `ocr_drafts`, `momo-ocr` domain model |
| DB schema / migration | `momo-db` | `../momo-db` migrations |

Redis は配送路であり、ジョブ状態の正本ではない。OCR Worker roleは`jobId`からDBを確認し、DB状態に基づいて
実行、破棄、またはackする。Redis / DB / ACKを行うのはprocessing parent processであり、OCR attempt childではない。

## 2. Redis Topology

| 項目 | 既定値 | env |
|---|---|---|
| v2 job stream | `momo:ocr:v2:jobs` | `OCR_REDIS_V2_STREAM` |
| v2 dead-letter stream | `momo:ocr:v2:jobs:dead` | `OCR_REDIS_V2_DEAD_LETTER_STREAM` |
| Outbox cold recovery | `300s` | `OCR_OUTBOX_RECOVERY_INTERVAL_SECONDS` |
| Delivered queued redelivery | `120s` | `OCR_OUTBOX_REDELIVERY_AFTER_SECONDS` |
| Outbox due backlog admission limit | `24` | `OCR_OUTBOX_DUE_BACKLOG_LIMIT` |
| Outbox active backlog admission limit | `48` | `OCR_OUTBOX_ACTIVE_BACKLOG_LIMIT` |
| Oldest due outbox max delay | `600s` | `OCR_OUTBOX_OLDEST_DUE_MAX_DELAY_SECONDS` |
| Dead-letter backlog admission limit | `24` | `OCR_DEAD_LETTER_BACKLOG_LIMIT` |

Rules:

- APIはv2 streamだけへ`XADD`し、別schemaを同じstreamへ混在させない。
- OCR consumerは`XGROUP CREATE ... MKSTREAM`を許容する。
- OCR consumerは`XREADGROUP`で新規配送を読み、stale PELは`XCLAIM`する。
- 即時 nack は使わない。
- OCR認識timeoutとPEL回収待機時間を別のbounded設定として扱い、混同しない。
- claim idle は、正当な長時間ジョブを重複配送しないよう API stale job reaper の基準値以上にする。
- OCR consumerのblocking readは、空queueでRedis commandsを増やしすぎないため長めに取る。メッセージ到着時は
  block終了を待たずに返るため、通常のOCR開始遅延にはしない。

## 3. Stream Payload v2

v2はRust OCR Worker role専用のobject-storage契約である。すべてのRedis field valueはstringとし、local path、bucket名、URL、credentialを含めない。

| Field | Required | Meaning |
|---|---:|---|
| `schemaVersion` | yes | `"2"` 固定 |
| `jobId` | yes | DB `ocr_jobs.id`。OCR Worker roleのidempotency key。1-128 printable ASCII chars |
| `draftId` | yes | DB `ocr_drafts.id`。1-128 printable ASCII chars |
| `sourceImageId` | yes | DB `source_images.id`。1-128 printable ASCII chars |
| `imageObjectKey` | yes | 非公開object storage内のopaque relative key。最大512 ASCII chars |
| `sha256` | yes | upload時に確定した画像bytesのlowercase SHA-256 hex |
| `byteLength` | yes | `1..3145728` のdecimal string |
| `mediaType` | yes | `image/png`, `image/jpeg`, `image/webp` |
| `requestedScreenType` | yes | `total_assets`, `revenue`, `incident_log`。`auto`禁止 |
| `attempt` | yes | payload schema上の正整数 |
| `enqueuedAt` | yes | ISO-8601 UTC timestamp |
| `ocrHintsJson` | no | compact / sorted keys / UTF-8 JSON string。最大8192 UTF-8 bytes |
| `requestId` | no | producer / outboxのログ相関ID。workerは形式を検証するが処理payloadには保持しない。`^[A-Za-z0-9_-]{1,64}$` |

Rules:

- producerはupload時にformat、静的画像、FullHD以下、3MiB以下を検証し、`source_images`へmetadataを確定してからenqueue intentを作る。
- workerはobject取得後に`sha256`、`byteLength`、`mediaType`を再検証し、不一致をOCRへ渡さない。
- `imageObjectKey`は取得識別子でありpathへ変換・連結しない。bucket、endpoint、credentialはruntime設定から得てpayloadへ複製しない。
- v2は閉じた契約であり、未知field、非string value、URL風/絶対/空/dot/parent segment keyを拒否する。
- producer payloadは閉じた契約として扱い、field追加でもschemaとScala/Rust contract testsを同時に更新する。
- processing parent process境界でもstream payload schemaを適用し、`ocrHintsJson`はJSON parse後にhints schemaも適用する。

## 4. OCR Hints

`ocrHintsJson` は省略可能な JSON object を string 化した Redis field。API は null を落とし、key をソートし、空白なしで出力する。

OCR capabilityはhintsを補助情報として扱う。画面種別、プレイヤー名、結果値の正本として扱わない。

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

API は OCR job 作成 transaction 内で `ocr_drafts`、`ocr_jobs`、`ocr_queue_outbox` を作成する。DB commit 後、通常経路ではcoalescing wakeを発行し、dispatcherがdue outboxを直ちにclaimして`XADD`を試みる。HTTP success は Redis publish 完了ではなく、DB に durable enqueue intent が残ったことを意味する。即時 publish に失敗した場合は outbox 行を backoff 後の `PENDING` へ戻し、runtimeが生存している間は`next_attempt_at`に合わせたone-shot wakeを予約する。wakeやtimerが失われてもstartup recoveryと低頻度cold recoveryが残りの `PENDING` / stale `IN_FLIGHT` を再配送する。

API は OCR job / draft / outbox 作成前に admission guard を実行する。Redis ping 失敗、due `PENDING` + expired `IN_FLIGHT` backlog 超過、`PENDING` + `IN_FLIGHT` active backlog 超過、oldest due outbox 遅延超過、dead-letter stream length 超過のいずれかでは、DB row を作らず `503 SERVICE_UNAVAILABLE` Problem Details で fail-fast する。閾値は通常利用（週1開催、1開催4〜6試合、担当者1人が試合後都度OCR）を妨げない初期値として設定し、env で変更可能にする。

Lifecycle:

```text
PENDING -> IN_FLIGHT -> DELIVERED
                 \-> PENDING (publish failure / retry)
DELIVERED -> PENDING (jobがthreshold後もqueuedのsemantic redelivery)
```

Rules:

- `ocr_queue_outbox.schema_version`と`stream_payload.schemaVersion`は一致させる。writerはv2 objectを保存し、
  `jobId`だけから再構築しない。
- `requestId` と OCR hints は API request 時点の値を保持する。
- OCR job作成transactionがcommitした後にだけwakeする。rollback、通常の作成拒否、既存rowを返すだけの
  経路では新しいwakeを必須にしない。
- PostgreSQL runtimeではcreation storeをpost-commit decoratorで包み、成功結果からwakeまでの短い区間を
  cancel maskする。HTTP usecaseからoutboxを再claimして直接`XADD`する経路は持たない。
- dispatcherはstartup、post-commit wake、予約retry、semantic redelivery、cold recoveryで起動する。
  retryとsemantic redeliveryの最短deadlineを1つだけ保持し、due workを空にした後はsignal、そのdeadline、
  cold recoveryのいずれかまでDB accessを停止する。固定短周期pollやrowごとのtimer fiberを作らない。
- recovery dispatcher は due `PENDING` と expired `IN_FLIGHT` を `FOR UPDATE SKIP LOCKED` で claim する。
- claimごとに新しいUUID `claim_token`を発行する。expired rowの再claimはtokenを必ず更新し、`DELIVERED`確定とretry releaseは同じtokenを持つclaimだけを受理する。時刻が一致しても旧claimへ実行権を戻さない。
- `XADD` 成功後に `DELIVERED`, `redis_message_id`, `delivered_at` を記録する。このDB更新まで成功した場合だけ
  そのdeliveryを完了とし、active dispatchを停止できる。
- `XADD` 失敗時は秘密情報を含まない error class だけを `last_error` に記録し、backoff 後の `PENDING` に戻す。
- claim queryなどdrain全体の失敗はdispatcherを停止またはhot loopさせず、最大60秒の指数backoff後に再試行する。
  backoff中のpost-commit wakeはcoalesceして保持し、依存回復後の正常drainでbackoffをresetする。
- `DELIVERED`から120秒経過しても対応`ocr_jobs.status`が`queued`なら、job rowをlockして状態を再確認した上で
  同じoutbox rowを`PENDING`へ再武装する。再武装では保存済みv2 payloadを保持し、claim、delivery identity、
  error、attempt countを新しいdelivery cycle用にclearし、`next_attempt_at`を現在時刻へ進める。
- semantic redeliveryは`running`またはterminal jobへ行わない。processing parent processのDB claimと重複delivery規則により、
  元messageが遅れて到着してもOCR処理を二重実行しない。
- cold recoveryはstartup時と既定300秒間隔で行う。既知のretryとsemantic redeliveryはこの間隔を待たず、
  one-shot wakeで処理する。

## 6. OCR Worker Role Delivery / Ack

この章のOCR Worker roleはprocessing parent process内の論理的な処理担当であり、OCR attempt child processそのものではない。
親processがRedis delivery、DB claim / lease / fence、object取得、子process supervision、durable write、ACKを所有する。
OCR childは親が検証したbounded image bytesから1 attemptのcandidateを返すだけで、DB / Redis / object storage、
outbox、ACKを扱わない。

原則: terminal DB write before `XACK`。`succeeded`, `failed`, `cancelled` の永続化前に ack しない。

Ack exceptions:

| 状態 | worker動作 |
|---|---|
| unknown `jobId` | DB正本に存在しない残骸として ack して破棄 |
| already terminal | 再実行せず ack |
| already running | 他workerの実行権を尊重し、再実行も失敗書き込みもせず ack |
| queued 確認後に別workerが先に running claim | already running と同じ扱いにし、再実行も失敗書き込みもせず ack |
| malformed payload with recoverable bounded-valid `jobId` | `QUEUE_FAILURE` を terminal failure としてDBに書いてから ack |
| malformed payload and failure write failed | ack せず PEL claim / DLQ に任せる |
| max attempts exceeded with recoverable bounded-valid `jobId` | `QUEUE_FAILURE` を terminal failure としてDBに書き、DLQへ `XADD` してから元messageを ack |
| max attempts exceeded and failure write failed | DLQ/ack せず PEL claim に任せる |
| max attempts exceeded without recoverable bounded-valid `jobId` | DLQへ `XADD` してから元messageを ack |

Worker rules:

- stale running job の terminal failure 化は API maintenance が担う。
- processing parent processはpayload中のlocal pathやURLを受理せず、opaque object keyで取得したbytesを検証してからOCRする。
- OCR attemptのtransient failureでは、親processがDB jobを将来時刻の`queued`へ戻し、元Redis deliveryをPELへ
  pendingのまま残す。新しい`ocr_queue_outbox`を作成・再武装せず、post-commit outbox wakeも発行しない。
- OCR roleによる期限切れAnalysis holder回収が`series_analysis_queue_outbox`を作る場合は、commit後にAnalysis
  outbox wakeを発行する。initiatorがOCR roleであることをwake先の判定に使わない。
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

- `ocr_jobs` は job lifecycle の正本。processing parent processは`SELECT ... FOR UPDATE`相当で現状を確認し、
  `queued -> running` claim時に`attempt_count`を増やす。
- 成功時は `ocr_drafts` upsert と `ocr_jobs` terminal transition を同一 transaction にする。
- `ocr_drafts.payload_json`, `warnings_json`, `timings_ms_json` は`momo-ocr`のOCR domain modelをJSON化した値。
- 1 job につき最大1 draft。ack 前 crash の再処理では同じ `job_id` を upsert する。
- `ocr_queue_outbox` は Redis publish intent の正本。DB schema 変更は `momo-db` migration と consumer 側検証を揃える。
- OCR outboxは1 job 1 rowを維持し、semantic redeliveryでは新規rowを増やさず既存`DELIVERED` rowを再武装する。
  `redis_message_id`と`delivered_at`は最新delivery cycleを表し、過去cycleの相関は安全な構造化logで行う。
- v2 jobの実行権はDB lease tokenと単調増加fenceで確定する。期限切れleaseを再取得したworkerだけが新fenceを持ち、古いworkerのterminal writeを拒否する。
- Redis publish は at-least-once。`XADD` 成功後に `DELIVERED` 更新が失敗すると recovery で再 publish され得る。
  processing parent processは`ocr_jobs`の状態確認によりterminal / running jobを再実行せずackする。

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

現行producer / consumer契約はv2だけである。DB上の過去rowを保持するためlegacy columnやschema version値が
残っていても、新しいv1 outbox、stream delivery、local-path jobを作らない。v2に非互換変更が必要なら
新しいschema versionとstreamを追加し、同じstream上のin-place変更やdual writeで曖昧にしない。

## 9. Required Tests

Redis contract に触れた場合:

```sh
cd apps/api
sbt testOnly momo.api.contracts.ocrworker.OcrWorkerJobMessageV2Spec
sbt testOnly momo.api.usecases.OcrQueueOutboxDispatcherSpec
sbt apiRedisQuality
sbt apiDbQuality
```

```sh
cd apps/processing-worker
cargo test --locked --workspace --all-targets --all-features
cd ../..
scripts/ci/ocr-rust-control-plane-smoke.sh
```

Scala/Rust双方のserializer / decoderを`docs/schemas/ocr-queue-payload-v2.schema.json`で検証する。

dispatcher testでは、post-commit wake、wake coalescing、startup/cold recovery、publish失敗後のone-shot retry、
`DELIVERED`確定後のidle、120秒後も`queued`のjobだけを対象とするsemantic redeliveryを固定する。時間境界は
実時間sleepではなく制御可能なclockで検証する。

DB schema に触れた場合は `docs/db-rule.md` と `docs/test-rule.md` に従い、`momo-db` migration 適用済み Testcontainers PostgreSQL で検証する。

## 10. Operations

障害調査で見るもの:

- API `/healthz/details` の Redis status。
- `ocr_queue_outbox` の `PENDING`, `IN_FLIGHT`, `FAILED` 件数と oldest `next_attempt_at`。
- Redis stream length、consumer group pending count、DLQ stream length。
- `jobId` によるAPI log、Processing Worker log、`ocr_jobs`、`ocr_queue_outbox`の横断検索。

ログに出さないもの:

- 画像内容
- OCR raw text 全文
- session / CSRF / OAuth token
- Redis URL / DB URL
