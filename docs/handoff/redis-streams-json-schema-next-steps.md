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

現状:

- API producer は test scope の JSON Schema validator で serializer 出力を検証している。
- worker は dev dependency の `jsonschema` で test 中に serializer 出力を検証している。
- 実行時の Redis payload parse は従来の手書き validation のままで、JSON Schema は直接使っていない。

リスク:

- 契約テストを通らない payload は開発中に捕まるが、runtime で DB outbox に入った古い payload や、
  手動投入・運用介入・将来の別 producer が作る schema-invalid payload は schema と同じルールで弾けない。
- worker parser と JSON Schema の validation 規則が時間とともに微妙にずれる可能性がある。

推奨:

- API: `OcrQueuePayload.build` 直後、または `ocr_queue_outbox` insert 直前で schema validation を行うか決める。
- worker: `parse_job_message` の先頭で stream payload schema を適用するか決める。
- worker runtime で schema validation する場合は、`jsonschema` を dev dependency から runtime dependency へ移す必要がある。
- runtime で採用しない場合も、「JSON Schema は test-only oracle」と明記し、worker parser 側で schema と同等の失敗ケースを追加する。

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
