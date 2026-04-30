# OCR Worker ↔ API 結合契約

このドキュメントは、API（Scala / Tapir）と OCR ワーカー（Python）の間で守るべき契約をまとめたものである。
API側の OpenAPI（Tapir定義が正本）とは別に、**ワーカーが何を期待し、何を返し、どう失敗するか**を定義する。

- 対象範囲: Redis Streams メッセージ、Postgres の `ocr_jobs` / `ocr_drafts` 契約、ステータス遷移、失敗コード、一時画像規約
- 想定読者: API実装者、運用者、スキーマ移行担当（summit側）
- 上位仕様との関係: 業務要求は `requirements/base.md`、技術構成は `requirements/system-design.md` を正とする。本書はワーカー側の実装表面に絞った契約書である。
- 実装参照: `apps/ocr-worker/src/momo_ocr/features/ocr_jobs/`

DBマイグレーションの正本は MVP 期間中 summit 側にある（`AGENTS.md` §4）。スキーマ変更時は summit の Drizzle マイグレーションを先に適用してから本ワーカーをデプロイする。

---

## 1. 役割と責務分担

| 責務 | 所在 |
| --- | --- |
| Discord OAuth、固定4名の認可、CSRF、API公開 | API |
| 画像アップロード受け取り（3MB制限・形式検証）、一時パス生成 | API |
| `ocr_jobs` 行の作成（status=`queued`）、Redis Streams への投入 | API（プロデューサ） |
| キャンセル要求（`cancelled` への遷移要求） | API |
| 一時画像の物理ファイル管理（書き込み）と存続保証 | API |
| キュー消費、画像読み込み、OCR、パース、結果永続化、画像削除、ack | OCRワーカー |
| 失敗の分類とユーザー向けエラーメッセージ生成 | OCRワーカー（コード） / API（表示） |
| 結果ドラフトの編集・確定 | API |
| `ocr_jobs.status` の最終遷移（`succeeded`/`failed`/`cancelled`） | OCRワーカー |
| マイグレーション owner | summit（MVP） |

**真実の源（source of truth）**:
- ジョブ状態は **DB（`ocr_jobs`）** が正本。Redis メッセージは配送のためのヒントに過ぎない。
- 重複配送・古いメッセージ・未知の `job_id` は DB を見て解決する。

---

## 2. Redis Streams メッセージ契約

### 2.1 ストリーム構造

- ストリーム名: `momo:ocr:jobs`（コンシューマグループ: `momo-ocr-workers`）。MVP では同時実行数 1（直列）。
- 投入方式: `XADD`。各メッセージは平坦な文字列フィールドのマップ。
- ack: ワーカーが DB の終端遷移（`succeeded`/`failed`/`cancelled`）を永続化した**後にのみ** `XACK`。
- nack: MVPでは即時nackを実装しない。ackされなかった配送は PEL（pending entries list）に残り、後続の再配送/claim 方針は `ocr-timeout-retry-dlq` で確定する。**冪等性は DB のステータス遷移で担保**するのが規約（後述）。
- 最大配送回数 / dead-letter: MVP 未確定（`AGENTS.md` §6.3）。実測後に値を決め、本書を更新する。

### 2.2 ペイロードフィールド

API 側はこの契約に従って `XADD` する。**フィールドはすべて文字列**（Redis Streams の制約）。値の型は受信側の `parse_job_message` で復元される。

| フィールド | 必須 | 型 | 説明 |
| --- | --- | --- | --- |
| `jobId` | ◯ | string | DB `ocr_jobs.id` と一致する一意ID |
| `draftId` | ◯ | string | 結果書き込み先 `ocr_drafts.id` |
| `imageId` | ◯ | string | 一時画像の論理ID（API側の追跡用） |
| `imagePath` | ◯ | string | ワーカーが読める絶対パス（同一VM共有FS前提） |
| `requestedImageType` | ◯ | string | `auto` / `total_assets` / `revenue` / `incident_log` のいずれか |
| `attempt` | ◯ | string(int≥1) | 配送回数。`1` から開始 |
| `enqueuedAt` | ◯ | string | RFC3339 / ISO8601 UTC タイムスタンプ |
| `ocrHintsJson` | △ | JSON string | 任意ヒント。後述 |

不正フィールドは `QUEUE_FAILURE` として扱われ、ワーカー側で失敗として永続化される（後述 §6）。

### 2.3 `ocrHintsJson`

JSON オブジェクトをそのまま文字列化した値。**省略可**。スキーマは以下：

```json
{
  "gameTitle": "桃太郎電鉄ワールド",
  "layoutFamily": "world",
  "knownPlayerAliases": [
    { "memberId": "uuid-...", "aliases": ["ぽんた", "PONTA"] }
  ],
  "computerPlayerAliases": ["さくま", "サクマ"]
}
```

セマンティクス:
- `gameTitle` / `layoutFamily`: パーサ選択のヒント。ワーカーは独自にも検出するため省略しても動く。
- `knownPlayerAliases[].memberId`: 共有DB `members.user_id` 等のID。ワーカーは結果ドラフトに `memberId` をひも付け返す（後述）。
- `knownPlayerAliases[].aliases`: そのメンバーが OCR 上で名乗り得る表記の網羅。短いもの（正規化後5文字未満）は安全のため無視される（誤マッチ防止）。
- `computerPlayerAliases`: コンピュータ「さくま」用のエイリアス。ワーカー上は他のプレイヤーと同様に正規名へ寄せるだけで、**さくまかどうかの特殊扱いは API 層以上で判断**する（要求 `requirements/base.md`）。

互換性ルール:
- フィールド追加は**後方互換**（ワーカーは未知フィールドを無視する）。
- 既存フィールドの型変更・削除は**後方非互換**としてバージョン折衝が必要。MVP では事前合意の上 API/ワーカー同時デプロイで対応する。
- ワーカー側は `parse_job_message` の `REQUIRED_STREAM_PAYLOAD_KEYS` で必須キーを集中管理している。追加時は両側を同期する。

---

## 3. DB契約: `ocr_jobs`

ワーカーは以下のカラムを期待する。型は論理仕様であり、summit 側のマイグレーションが物理型を最終決定する。

| カラム | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | uuid/text | ◯ | `jobId` と一致 |
| `draft_id` | uuid/text | ◯ | `ocr_drafts.id` への参照 |
| `image_id` | text | ◯ | 一時画像論理ID |
| `image_path` | text | ◯ | ワーカーから読める絶対パス |
| `requested_screen_type` | text | ◯ | enum値（§2.2） |
| `detected_screen_type` | text | – | ワーカーが検出した画像種別 |
| `status` | text | ◯ | enum: `queued`/`running`/`succeeded`/`failed`/`cancelled` |
| `attempt_count` | int | ◯ | 実行試行回数。ワーカーが `running` 遷移時にインクリメント |
| `worker_id` | text | – | 直近で `running` に遷移させたワーカー識別子 |
| `failure_code` | text | – | §6 の `FailureCode` 値 |
| `failure_message` | text | – | ユーザー/運用者向け説明 |
| `failure_retryable` | bool | – | `true` のとき API 層で再試行 UI を提示する |
| `failure_user_action` | text | – | ユーザーへの推奨アクション（再アップロード等） |
| `started_at` | timestamptz | – | `running` 遷移時刻 |
| `finished_at` | timestamptz | – | 終端遷移時刻 |
| `duration_ms` | int | – | OCRパイプライン全体の実測（参考値） |
| `created_at` / `updated_at` | timestamptz | ◯ | 監査用 |

実装参照: `apps/ocr-worker/src/momo_ocr/features/ocr_jobs/models.py` (`OcrJobRecord`)、`shared/errors.py` (`OcrFailure`)。

### ステータス遷移

`apps/ocr-worker/src/momo_ocr/features/ocr_jobs/lifecycle.py` で集中管理。

```
queued ──► running ──► succeeded
   │           │           (terminal)
   │           ├──► failed
   │           │     (terminal)
   │           └──► cancelled
   │                 (terminal)
   ├──► cancelled (API がキューイング前後にキャンセルした場合)
   └──► failed   (API 側で永続的に却下する場合; 例: 画像が存在しない)
```

- 終端ステータスからは遷移しない。`OcrJobStatus.SUCCEEDED/FAILED/CANCELLED` への再遷移は禁止（`ensure_transition_allowed` が違反時に `DB_WRITE_FAILED` を投げる）。
- `running` への遷移は**ワーカーのみ**が行う。API は `queued` 作成と `cancelled` 要求にのみ責任を持つ。
- 同じ `job_id` の再配送が来た場合、ワーカーは `get_for_update` で現状を確認し、終端ステータスならば ack して破棄する（冪等性）。

### キャンセル

- API は `ocr_jobs.status` を直接 `cancelled` に更新する形でキャンセル要求を表現する（`queued` → `cancelled`）。
- ワーカーは2点でキャンセルを再確認する:
  1. ジョブを `running` に遷移させる前
  2. `running` に遷移させた直後（既にキャンセル済みなら自前で `cancelled` 扱いに整合させる）
- 実行中のキャンセルは MVP では best-effort。OCR 解析途中での即時中断はサポートしない（次の同期点まで進む）。

### 排他

- ワーカーは `get_for_update` 相当のロックでレコードを取得し、`running` 遷移と `attempt_count` インクリメントを **同一トランザクション**内で行うことを期待する。
- 実装: `PostgresOcrJobRepository` は `SELECT ... FOR UPDATE` で現状を確認し、`running` 遷移は `UPDATE ... WHERE status = 'queued'` によって `attempt_count` インクリメントと同時にclaimする。終端遷移は `queued`/`running` のみを対象にし、終端済みジョブの二重配送は ack して破棄する。

---

## 4. DB契約: `ocr_drafts`

ワーカーは結果を `ocr_drafts` に書き込む。**1ジョブあたり最大1ドラフト**。同じ `job_id` で再書き込みされた場合は最新で上書きする（`ack` 前にプロセスが落ちた等のケース）。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | uuid/text | `draftId` と一致 |
| `job_id` | uuid/text | `ocr_jobs.id` への参照 |
| `requested_screen_type` | text | 入力エコー |
| `detected_screen_type` | text | ワーカー検出値 |
| `profile_id` | text | レイアウトプロファイル識別子（例: `world.total_assets.v1`） |
| `payload_json` | jsonb | `OcrDraftPayload` のシリアライズ。後述 |
| `warnings_json` | jsonb | `OcrWarning[]`（重要度・コード・対象フィールドパス付き） |
| `timings_ms_json` | jsonb | ステージ別の処理時間（参考値） |
| `created_at` / `updated_at` | timestamptz | 監査用 |

### `payload_json` 構造（`OcrDraftPayload`）

実装参照: `features/ocr_domain/models.py`。スネークケースのまま JSON にする想定（API 側で必要に応じてリネームしてOpenAPIへ載せる）。

```json
{
  "requested_screen_type": "total_assets",
  "detected_screen_type": "total_assets",
  "profile_id": "world.total_assets.v1",
  "players": [
    {
      "raw_player_name": { "value": "ぽんた社長", "raw_text": "...", "confidence": 0.91, "warnings": [] },
      "member_id": "uuid-...",
      "play_order": { "value": 1, "raw_text": "青", "confidence": 1.0, "warnings": [] },
      "rank": { "value": 1, "raw_text": "1", "confidence": 0.95, "warnings": [] },
      "total_assets_man_yen": { "value": 12345, "raw_text": "12345", "confidence": 0.92, "warnings": [] },
      "revenue_man_yen": { "value": null, "raw_text": null, "confidence": null, "warnings": [] },
      "incidents": {
        "目的地": { "value": 3, "raw_text": "3", "confidence": 0.88, "warnings": [] }
      }
    }
  ],
  "category_payload": {},
  "warnings": [],
  "raw_snippets": null
}
```

注意:
- `OcrField` は `value` が `null` でも `raw_text` / `confidence` / `warnings` を持つ。API 層は値の信頼性判定にこれらを使う。
- 画像種別ごとにフィールドの有意性は変わる（例: 収益額画像では `total_assets_man_yen` は欠落しても正常）。
- `member_id` は `knownPlayerAliases` ヒントから解決された場合のみ埋まる。未解決時は API 側で名前文字列を頼りに別途マッチングする。
- 単位は **万円整数**（`requirements/base.md`）。順位は OCR/手入力が正で、金額から再計算しない。

### `warnings_json` 構造

```json
[
  {
    "code": "LOW_CONFIDENCE",
    "message": "...",
    "severity": "warning",
    "field_path": "players[2].total_assets_man_yen"
  }
]
```

`code` の取り得る値は `WarningCode` enum（`features/ocr_domain/models.py`）。新規追加はワーカー側で先行可能（API 層は未知コードを「警告」として透過表示）。

---

## 5. 一時画像規約

- API は `imagePath` に **ワーカーから読める絶対パス**を渡す。同一 Fly VM 内ファイルシステム共有が前提（supervisord 配下の同居プロセス）。
- 上限 3MB / PNG・JPEG・WebP（`AGENTS.md` §6.2）。検証は API 側責務。
- ワーカーは終端遷移後に **best-effort で削除** する（成功/失敗/キャンセル問わず）。削除失敗はジョブ失敗にしない（ログに残すのみ）。
- VM 再起動等で画像が消えた場合、ワーカーは `TEMP_IMAGE_MISSING` で `failed` 終端させ、`retryable=false` / `user_action=「画像を再アップロードしてください」` を返す。
- API 側は **OCR 完了前のユーザー再ダウンロード**用に画像を保持する（要求）。完了後はサーバから消去し恒久保存しない。

---

## 6. 失敗コード一覧

実装: `apps/ocr-worker/src/momo_ocr/shared/errors.py` (`FailureCode`).
API はこの enum を**そのまま**保存・分岐する（不明なコードは保守的に retryable=false 扱い）。

| コード | 想定原因 | retryable | API側ユーザー対応の指針 |
| --- | --- | --- | --- |
| `TEMP_IMAGE_MISSING` | 一時画像が消えた／VM再起動 | false | 「画像を再アップロード」 |
| `INVALID_IMAGE` | バイト列破損 | false | 「画像を再アップロード」 |
| `UNSUPPORTED_IMAGE_FORMAT` | 形式違反 | false | 「PNG/JPEG/WebP のみ可」 |
| `IMAGE_TOO_LARGE` | 3MB 超 | false | 「画像サイズを縮小して再アップロード」 |
| `DECODE_FAILED` | OpenCV/Pillow デコード失敗 | false | 「画像を再アップロード」 |
| `CATEGORY_UNDETECTED` | 画像種別が判別できない | false | 「画像種別を手動指定」 |
| `LAYOUT_UNSUPPORTED` | 未対応レイアウト | false | 「対応作品か確認、手入力に切替」 |
| `OCR_TIMEOUT` | OCR が時間超過 | true | 「再試行」 |
| `OCR_ENGINE_UNAVAILABLE` | Tesseract起動失敗等 | true | 「しばらく待って再試行」 |
| `PARSER_FAILED` | パーサ内部例外 | false | 「手入力に切替、または別画像で再試行」 |
| `DB_WRITE_FAILED` | 終端遷移書き込み失敗 | true | 「再試行」 |
| `QUEUE_FAILURE` | メッセージ不正 | false | 「運用に連絡」 |

`OcrFailure` は `code` `message` `retryable` `user_action?` を持ち、`failure_*` カラムにそのまま展開される。

---

## 7. ack / 冪等性 / 配送セマンティクス

ワーカー側の不変条件（`runner.py`）:
1. **DB 永続化が ack より先**: 終端ステータス（`succeeded`/`failed`/`cancelled`）の遷移を DB にコミットしてから `XACK` する。
2. **未知 `jobId` は ack して破棄**: DB に行が存在しないメッセージは過去の残骸とみなして削除する。
3. **既終端 `jobId` は ack して破棄**: 二重配送時は何もせず ack のみ行う。
4. **画像削除は ack の前**（best-effort）: 失敗してもジョブを失敗化しない。
5. **想定外例外**: 直接 ack せず、`PARSER_FAILED` で `failed` に終端させてから ack。これにより無限再配送ループを防ぐ。

API 側で前提にしてよい性質:
- `succeeded` は同一 `jobId` で**最大1回**観測される。
- `failed` 観測後、同じ `jobId` の再ジョブ作成は**新規 `jobId` でやり直し**（既存行を `queued` に戻さない）。
- `attempt_count` はワーカーの再試行回数を反映するが、ユーザーへ表示する値ではない（運用観点用）。

---

## 8. レート制限・同時実行

- ワーカーの同時実行数は MVP で **1ジョブ直列**（`AGENTS.md` §6.3）。
- API はキュー深度を制限する責任を負う（ユーザー操作からの DoS 防止）。アップロード/ログイン/CSV と同様に軽いレート制限を入れる。
- OCR タイムアウト・最大配送回数は実測後に決定する。決定したら本書 §2.1 と §6 を更新する。

---

## 9. ロギング・観測性

- ワーカーは構造化 JSON ログを stdout に書く（`AGENTS.md` §12）。ジョブログには `jobId` / `draftId` / `workerId` / `status` / `failure_code` を含める。
- **禁止事項**: 画像内容、OCR 抽出生テキスト全文、CSRF/セッショントークン、Discord トークンをログに出さない。
- API ログ側でも `jobId` をキーに横断検索可能な形にする（同一 `jobId` でログを束ねる前提）。
- `duration_ms` を `ocr_jobs.duration_ms` に保存することで、API 側ダッシュボード（将来）で OCR 性能を観測できる。

---

## 10. テスト戦略

| レベル | 場所 | 目的 |
| --- | --- | --- |
| ワーカー単体 | `tests/unit/features/test_ocr_job_runner.py` | ライフサイクル、ack順序、エラー分類、ヒント伝播 |
| ワーカー結合（OCR本体） | `tests/golden/` 等 | 実画像→ドラフト |
| 契約テスト（API↔ワーカー） | API側 + ワーカーの `queue_contract.py` | `to_stream_payload`/`parse_job_message` の往復、必須キー、ヒント JSON スキーマ |
| API 結合 | API リポジトリ / `RedisQueueProducerSpec` | `ocr_jobs` 行作成→`XADD`→終端ステータス監視→ドラフト読み出し |
| ワーカー結合 | `tests/integration/` | Redis Streams consumer、Postgres repository/result writer、Redis→worker→Postgres smoke |
| E2E | Playwright | アップロード→OCR完了→確定までの主要フロー |

API 側で実施してほしいこと:
- `to_stream_payload` の **JSON スナップショット**を共有テストフィクスチャ化し、API 側のプロデューサ実装と同じバイト列であることを CI で確認する（破壊的変更検知）。
- `failure_code` 全 enum 値に対する UI ハンドリング網羅テスト。

---

## 11. 互換性とバージョニング

- メッセージスキーマ（§2）と DB スキーマ（§3, §4）はワーカーの `models.py` と `queue_contract.py` を**正本**として運用する。
- 本物アダプタ実装は API 側 `RedisQueueProducer`、ワーカー側 `RedisOcrJobConsumer` / `PostgresOcrJobRepository` / `PostgresOcrResultWriter` を参照する。
- 後方互換: 追加フィールド（メッセージ・JSON・DB列）は OK。デフォルト値で既存実装が壊れないこと。
- 後方非互換: 既存フィールドの意味/型変更、削除、enum 値削除は API/ワーカー/summit 同時デプロイで対応する。デプロイ順は **summit マイグレーション → ワーカー → API**。
- ワーカーリリースには本書の改訂を必須とする。

---

## 12. 未確定事項（要追従）

- OCR タイムアウト値・最大再配送回数（実測待ち）
- DLQ（dead-letter queue）方針
- API 側のキャンセル UI と再投入の UX
- `ocr_drafts.payload_json` を OpenAPI に載せる際のフィールド命名（snake_case / camelCase）
