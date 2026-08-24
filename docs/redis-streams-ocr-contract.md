# OCR Redis Streams Contract

目的: API producer と Processing Worker の OCR consumer 間にある payload、outbox、delivery、retry、ACK の意味論を定義する。field shape / limit は JSON Schema、DB shape は `../momo-db`、現在の topology / timeout は runtime 設定を正本とする。

関連正本:

- payload: `docs/schemas/ocr-queue-payload-v2.schema.json`
- hints: `docs/schemas/ocr-hints-v1.schema.json`
- job lifecycle: `docs/domain-rule.md`
- DB transaction: `docs/db-rule.md`
- parent / child boundary: `docs/architecture.md`
- test / command: `docs/test-rule.md`、`docs/dev-rule.md`

## 1. Ownership

| 契約 | Owner / 正本 |
| --- | --- |
| v2 payload | API producer、Rust consumer、JSON Schema、共有 fixture |
| durable enqueue intent | DB outbox |
| OCR job / draft state | DB |
| stream delivery / PEL / DLQ | Redis |
| schema / migration | `../momo-db` |

Redis は少なくとも1回配送する transport であり、job 状態の正本ではない。consumer は `jobId` から DB 状態を確認して実行または破棄する。Redis / DB / ACK は processing parent process が所有し、attempt child は扱わない。

## 2. Stream / Payload v2

- producer は version ごとに専用 stream を使い、異なる schema を同じ stream に混在させない。consumer group は stream が未作成でも初期化できること。
- 新規 delivery は blocking read、stale PEL は startup と低頻度 recovery で扱う。PEL は bounded page で走査し、page 間に新規 delivery を処理して飢餓と短周期 polling を防ぐ。
- transient retry の既知 PEL entry は claim 可能時刻に個別確認し、process 停止後は PEL recovery が回収する。即時 nack や新規 message による retry へ置き換えない。
- claim 前に delivery count と idle を再確認し、bounded attempt を超えた entry だけを DLQ 判断へ進める。OCR execution timeout と PEL claim idle を同じ設定にしない。
- payload field、型、上限、列挙値は v2 schema を正本とし、全 Redis value は string とする。未知 field、非 string value、schema 違反を拒否する。
- payload は非公開 object の opaque key と、取得後の再検証に必要な ID / metadata だけを運ぶ。local path、URL、bucket、endpoint、credential を含めない。
- producer は upload metadata を確定してから enqueue intent を作り、consumer は取得 bytes の length、media type、checksum を OCR 前に再検証する。object key を filesystem path として連結しない。
- `requestedScreenType` は明示し、legacy decode を除いて `auto` を受理しない。
- `ocrHintsJson` は hints schema に従う省略可能な補助情報であり、画面種別、player、OCR 結果の正本にしない。
- `requestId` と hints は enqueue 時の値を outbox payload に保持し、retry 時に job row だけから再構築しない。

## 3. Producer / Outbox

HTTP success は Redis publish 完了ではなく、DB に job、draft、durable enqueue intent が確定したことを意味する。

```text
PENDING -> IN_FLIGHT -> DELIVERED
                 \-> PENDING  (publish failure)
DELIVERED -> PENDING            (queued jobのsemantic redelivery)
```

- job / draft / outbox は同じ transaction で作成し、commit 後にだけ coalescing wake を送る。rollback、受付拒否、既存 row の replay で新規 wake を必須にしない。
- admission guard は Redis 到達不能、due / active outbox、oldest due delay、DLQ backlog を判定し、危険域では row を作らず fail fast する。閾値は runtime 設定を正本とする。
- dispatcher は startup、wake、retry / semantic deadline、cold recovery を待ち、bounded drain する。due work がなければ DB access を止め、固定短周期 polling や row ごとの timer を作らない。
- due `PENDING` と stale `IN_FLIGHT` は lock を競合回避して claim し、claim ごとに新しい identity を発行する。完了 / retry は同じ claim identity だけが更新できる。
- `XADD` 後に message identity と `DELIVERED` を DB へ確定して初めて publish 完了とする。DB 更新失敗時は再 publish を許容する。
- publish / drain failure は安全な error class と次回時刻を保存し、bounded backoff する。wake は保持するが backoff を迂回して hot loop しない。
- `DELIVERED` のまま threshold を超えて `queued` の job だけを、DB lock 下で同じ outbox row の `PENDING` へ再武装する。保存済み payload は変えない。
- `running` / terminal job、recent delivery、active claim を semantic redelivery しない。1 job 1 outbox row を維持する。

## 4. Consumer Delivery / ACK

原則は terminal DB write before `XACK`。DB の `succeeded`、`failed`、`cancelled` を確定する前に ACK しない。

| Delivery / DB state | 動作 |
| --- | --- |
| unknown `jobId` | DB に存在しない残骸として ACK |
| already terminal | 再実行せず ACK |
| already running、または claim 競合に敗れた | owner を尊重し、再実行・失敗書込みをせず ACK |
| malformed、bounded-valid `jobId` を回収可能 | `QUEUE_FAILURE` を DB へ terminal write 後に ACK |
| malformed、failure write 失敗 | ACK せず PEL recovery に委ねる |
| attempt 上限、bounded-valid `jobId` を回収可能 | terminal failure、DLQ write の順に成功してから ACK |
| attempt 上限、`jobId` を回収不能 | DLQ write 後に ACK |
| DLQ / terminal write 失敗 | ACK せず PEL recovery に委ねる |

- queued job の claim は DB lease / fence で確定し、stale owner の terminal write を拒否する。
- success は draft upsert と job terminal transition を同じ transaction にする。1 job の再処理は同じ draft を冪等に更新する。
- transient OCR failure は job を将来時刻の `queued` へ戻し、元 delivery を PEL に残す。新規 outbox、semantic redelivery、outbox wake を作らない。
- OCR role が別種の outbox を commit した場合は、initiator ではなく outbox 種別に対応する wake を commit 後に送る。
- stale running job の terminal 化は maintenance が所有する。running 中の cancel は即時中断を保証しない。
- terminal transition と前状態の詳細は `docs/domain-rule.md` を正本とする。

## 5. DB / Delivery Guarantees

- Redis publish は at-least-once とし、consumer は DB 状態、lease、fence、job ID で冪等にする。
- outbox の schema version と保存済み payload version は一致させる。
- message identity と delivery timestamp は最新 cycle を表し、過去 cycle の相関は secret を含まない structured log で行う。
- draft payload、warning、timing の domain shape は OCR capability が所有する。Redis payload と DB row shape へ同じ型を漏らさない。
- DB schema を変える場合は migration、producer、consumer、DB contract を同じ compatibility 計画で更新する。

## 6. Compatibility

後方互換として扱えるのは、consumer が無視または default 化できる optional field / warning の追加と、DB の nullable / default 付き追加である。ただし schema と producer / consumer contract test は同時更新する。

required field の削除・rename、型・意味・単位の変更、既存 enum 値の削除、ACK順序、DB正本性、terminal条件の変更は非互換とする。非互換変更は新しい schema version と stream を追加し、同じ stream の in-place変更や曖昧な dual write を行わない。

新規 producer / consumer は v2 だけを扱う。legacy row / column を保持していても、v1 outbox、v1 delivery、local-path job を新規作成しない。

## 7. Verification

- 共有 canonical fixture を JSON Schema、Scala serializer / decoder、Rust serializer / decoder のすべてへ通す。各言語で都合のよい fixture を作らない。
- producer transaction、post-commit wake、claim fencing、publish 後 DB failure、retry、semantic redeliveryを実 PostgreSQL と制御可能 clock で検証する。
- blocking read、PEL recovery、delivery count、claim、DLQ、ACKを隔離した実 Redis で検証する。
- consumer は duplicate、terminal / running、malformed、stale fence、transient failure、terminal write failure、DLQ failure を直接通す。
- DB schema 変更は migration 適用済み PostgreSQL、wire 変更は producer / consumer contract、parent / child 変更は process / control-plane smoke を使う。
- command と変更 gate は `docs/dev-rule.md` を正本とし、external gate 未実行は未検証として報告する。

## 8. Operations

監視は DB の outbox backlog / oldest due、job state、Redis stream / PEL / DLQ、producer / consumer health を別々に見る。Redis の entry だけから job の成否を推測しない。

調査時は `jobId` を安全な相関 key とし、API log、worker log、job、outbox、delivery を追う。画像内容、OCR raw text、session / CSRF / OAuth token、Redis / DB URL を log や public docs に出さない。
