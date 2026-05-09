# Redis Streams JSON Schema 見直し後の改善引き継ぎ

作成日: 2026-05-09

## 背景

Redis Streams / OCR queue 契約は `docs/redis-streams-ocr-contract.md` と
`docs/schemas/ocr-queue-payload-v1.schema.json` / `docs/schemas/ocr-hints-v1.schema.json`
を正本にした。共有 JSON fixture は廃止し、Scala/Python の契約テストは各 serializer 出力を
JSON Schema で検証する形に寄せた。

この整理で、契約の「テスト時の検証」は強くなった。一方で、runtime 境界・DB outbox 境界・将来の
versioning にはまだ改善余地がある。

## 次に取り組む推奨順

### 1. Runtime 境界での schema validation 方針を決める

対応状況:

- 2026-05-09: worker runtime dependency として JSON Schema validator を採用した。
- worker `parse_job_message` は stream payload schema と hints schema を runtime 境界で適用し、schema validation 後に型変換する。
- 方針は `docs/redis-streams-ocr-contract.md` と `apps/ocr-worker/README.md` に明記済み。

現状:

- API producer は test scope の JSON Schema validator で serializer 出力を検証している。
- worker は runtime dependency の `jsonschema` で、test 中の serializer 出力と実行時の Redis payload parse の両方を検証している。
- worker parser は schema validation 後、domain model への型変換と絶対 `imagePath` など JSON Schema だけで表しにくい境界条件を検証する。

解消したリスク:

- runtime で DB outbox に入った古い payload、手動投入、運用介入、将来の別 producer が作る schema-invalid payload は、
  worker 境界で schema と同じルールで弾けるようになった。
- worker parser と JSON Schema の validation 規則が時間とともにずれるリスクは、parser 前段で schema を直接適用することで低減した。

残:

- 完了: worker runtime で schema validation を採用し、`jsonschema` を runtime dependency へ移した。
- 残: API producer runtime validation は未採用。必要になった場合は、test scope の validator を runtime dependency に移す影響と、DB outbox insert 失敗時の HTTP/transaction 挙動を別途設計する。

### 2. `ocr_queue_outbox.stream_payload` の DB/integration 検証を schema 軸に寄せる

現状:

- `stream_payload` は Redis Stream に送る payload の保存先だが、DB 側では JSON object であること以上の検証は限定的。
- `apiDbQuality` は outbox row の存在や値を確認しているが、JSON Schema 正本とはまだ直接結びついていない。

リスク:

- API serializer は schema-valid でも、DB repository 経由の保存・復元で payload shape が崩れた場合に、
  DB integration 側だけでは検出が弱い。
- `momo-db` 側に JSON Schema extension を入れない限り、DB CHECK で schema 全体を表現するのは重い。

推奨:

- `PostgresOcrJobCreationRepositorySpec` または `PostgresOcrQueueOutboxRepositorySpec` で、
  保存された `stream_payload` を読み戻して `docs/schemas/ocr-queue-payload-v1.schema.json` で検証する。
- `ocrHintsJson` がある場合は parse 後に `ocr-hints-v1.schema.json` でも検証する。
- DB constraint は当面 `jsonb_typeof(stream_payload) = 'object'` 程度に留め、schema 全体の assert は consumer repository test に置く。

### 3. payload version と size limit を検討する

現状:

- schema ファイル名と `$id` は v1 だが、Redis payload 自体には `schemaVersion` field がない。
- `ocrHintsJson` の中身、alias 数、文字列長、payload 全体サイズには明示的な上限がない。

リスク:

- 将来 v2 が必要になったとき、stream / outbox に残る v1 payload と新 payload の判別が暗黙になる。
- OCR hints が大きくなりすぎると、Redis Stream、DB outbox、ログ調査、DLQ 調査の運用コストが上がる。

推奨:

- 次の後方互換変更として `schemaVersion: "1"` を optional field で追加するか検討する。
- `ocr-hints-v1.schema.json` に `maxItems` / `maxLength` を入れる。候補:
  - `knownPlayerAliases`: 最大 4 または UI/API が許す人数上限
  - `aliases`: 1 member あたり最大 8 程度
  - alias 文字列: 最大 64 文字程度
  - `ocrHintsJson`: stream payload 側で最大文字数を設定
- 上限を入れる場合は API request validation、serializer、worker parser、schema test を同じ変更で更新する。

## 参照

- `docs/redis-streams-ocr-contract.md`
- `docs/schemas/ocr-queue-payload-v1.schema.json`
- `docs/schemas/ocr-hints-v1.schema.json`
- `apps/api/src/test/scala/momo/api/repositories/OcrQueuePayloadSpec.scala`
- `apps/ocr-worker/tests/unit/features/test_queue_contract.py`
