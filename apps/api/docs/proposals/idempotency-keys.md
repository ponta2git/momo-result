# Idempotency Keys 設計提案 (apps/api)

> Phase 4-c の成果物。実装ではなく**設計の合意取り**を目的とする。スキーマ DDL は MVP 期間中 momo-summit 側が所有するため、決定事項は最終的に summit 側 PR で投入する。

## 1. 目的

- ネットワーク再試行・ブラウザ二重送信などで「同じ POST を二回送ってしまった」結果として副作用が二重に発生することを防ぐ。
- クライアントが `Idempotency-Key` ヘッダを送ると、API は **初回のレスポンスを保存し、以後同じキーには保存済みレスポンスを返す**ことを保証する。
- スコープは **作成系 / 状態遷移系の POST と DELETE** に限定する。GET には適用しない。

## 2. 対象エンドポイント

実エンドポイントを `apps/api/src/main/scala/momo/api/endpoints/` から拾った結果、本提案の対象は次の通り。

| エンドポイント | 対応する usecase | 備考 |
| --- | --- | --- |
| `POST /api/match-drafts` | `CreateMatchDraft` | 主要対象。新規ドラフト作成。 |
| `POST /api/match-drafts/:id/cancel` | `CancelMatchDraft` | 状態遷移。再送が論理的に同じ取り消しでも、外部観測上は冪等で返したい。 |
| `POST /api/ocr-jobs` | `CreateOcrJob` | キューにも publish するため特に重要。 |
| `POST /api/held-events` | `CreateHeldEvent` | 主要対象。 |
| `POST /api/matches/confirm` | `ConfirmMatch` | 確定はビジネスインパクトが大きい。 |
| `POST /api/masters/...` (game-titles, map-masters, season-masters) | `CreateMaster` 系 | UI からの二重作成防止。 |
| `POST /api/uploads` | `UploadImage` | 大容量 binary。サーバ側コストの観点でも望ましい。 |

**対象外:**
- `PUT /api/matches/:id` (`UpdateMatch`) — 同じ body の PUT は本来冪等なので、まず Idempotency-Key を要求しない方針。
- `DELETE /api/matches/:id`, `DELETE /api/ocr-jobs/:id` — 同様にメソッド側で冪等。`Idempotency-Key` をオプション扱いで受け入れるかは将来の宿題。
- `POST /api/auth/...` — セッション・OAuth は別のリプレイ防止機構（state, nonce）に責務を持たせる。

## 3. 振る舞い

クライアントは状態変更系 POST に **任意で** `Idempotency-Key: <UUIDv4 など 1〜255 文字>` ヘッダを付ける。サーバの判定は次のとおり。

1. **キーなし** → 通常処理（`Idempotency-Key` を要求しないので互換性は保たれる）。
2. **キーあり / 初回** → リクエストハッシュとレスポンス（status, headers, body）を保存してから返す。
3. **キーあり / 二回目以降, ハッシュ一致** → 保存済みのレスポンスをそのまま返す（DB 副作用は起こさない）。
4. **キーあり / 二回目以降, ハッシュ不一致** → `409 Conflict` を返し、`detail` で「同じ Idempotency-Key で異なる payload が送られた」旨を伝える。
5. **キーあり / 同時並行(処理中)** → `409 Conflict` で「処理中なのでリトライしてください」を返す。実装は INSERT 競合を `unique_violation` で検出し、レスポンス未保存なら処理中とみなす。

リクエストハッシュは `SHA-256(method || path || canonical(body))` の hex。`canonical(body)` は JSON のキーをソート、whitespace 正規化したバイト列。multipart/form-data は当面サポート外（→ uploads は別途検討）。

## 4. スキーマ案

```sql
-- momo-summit 側で投入する想定。MVP では summit が migration owner。
CREATE TABLE idempotency_keys (
  key            TEXT        NOT NULL,
  member_id      TEXT        NOT NULL REFERENCES members(id),
  endpoint       TEXT        NOT NULL,            -- "POST /api/match-drafts" など
  request_hash   BYTEA       NOT NULL,
  response_status INTEGER    NOT NULL,
  response_headers JSONB     NOT NULL DEFAULT '{}',
  response_body  BYTEA,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, member_id, endpoint)
);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys(expires_at);
```

### PK の設計理由

- `key` 単独ではなく **`(key, member_id, endpoint)` の複合 PK** にする。
  - 別メンバーが偶然同じ key を送っても衝突させない。
  - 同じメンバーが同じ key を別エンドポイントで使い回すユースケースを許容する（フロントの実装を強制しすぎない）。
- 別案: `key` 単独 PK + `(key, member_id, endpoint)` の `UNIQUE`。`UPSERT` の都合では大差なく、命名と意図のわかりやすさで複合 PK を採用。

### 列の選択理由

- `response_body` は `BYTEA`。MVP では JSON しか返さないが、将来の binary ダウンロード（CSV）に備えて bytes で持つ。**Content-Type は `response_headers` 経由で復元**する。
- `response_headers` は `JSONB`。`Content-Type`, `Location` など必要なものだけ保存し、`Set-Cookie`・`Authorization` 系は保存禁止（後述）。
- `request_hash` は `BYTEA(32)`。SHA-256 を生で。
- `expires_at` を持つことで cleanup ジョブが `WHERE expires_at < now()` で消せる。

## 5. 保持期間とクリーンアップ

- **保持期間: 24 時間**（`expires_at = created_at + interval '24 hours'`）。Stripe / GitHub などと同程度。
- クリーンアップ手段の優先順位:
  1. **summit 側の既存 cron** に「expires_at 経過分の DELETE」タスクを追加する（推奨。インフラを増やさない）。
  2. Neon の `pg_cron` を使う（追加検証が必要）。
  3. API 起動時の bootstrapper で 1 回だけ DELETE する（最終手段。長時間稼働で詰まる）。
- 削除は物理 DELETE で良い。監査ログとしての価値は低い。

## 6. リクエスト / レスポンスの取り扱い注意

- **保存対象に入れないもの:**
  - 任意の `Authorization`, `Cookie`, `Set-Cookie`, `X-CSRF-Token` 系ヘッダ。
  - リクエスト body のうち、画像 binary は明示的に対象外（→ uploads は別途検討）。
  - OAuth トークン、セッション ID 文字列。
  - これらは `lessons.md` の「シークレットを log/persist しない」に従い、HTTP ミドルウェア層で **保存前にフィルタ**する責務を負う。
- **保存対象に入れて良いもの:**
  - JSON body（API のレスポンス）と最小限のヘッダ（`Content-Type`, `Location`, `ETag` 程度）。
  - HTTP status code。

## 7. レイヤリング

- ドメインに新しい概念を入れない。`apps/api/src/main/scala/momo/api/repositories/IdempotencyAlg.scala` を `Alg[F0]` として切り出し、`IdempotencyRepository[F]` facade で `ConnectionIO → F` を扱う。Phase 3 の `HeldEventsAlg` パターンに合わせる。
- エンドポイント側は **Tapir の interceptor / ルータ層** で透過的に処理する想定。ハンドラ実装の boilerplate にしない。具体配線は本提案では決定せず、Phase 5 以降で決める。

## 8. momo-db / 配信順序

1. summit 側で migration PR を出す（テーブル + index + 有効期限カラム）。
2. summit 側 cron に cleanup ジョブを足す PR を出す。
3. API 側で `PostgresIdempotencyRepository` の実装を有効化する（Phase 4-d で stub のみ）。
4. API のミドルウェア配線 PR を出す（Phase 5）。
5. クライアントから `Idempotency-Key` を送る変更を出す（同 Phase）。

順序が崩れるとアプリは API レベルでテーブル参照に失敗するため、**summit 側 1, 2 → API 側 3 → 4, 5** を厳守する。

## 9. 未解決の論点（実装着手前に確認）

1. `member_id` を PK に含めるか、`UNIQUE` 制約にするか。 → 本提案は PK 採用。
2. 24h リテンションでよいか、運用要件として 7 日くらい欲しいか。 → 24h を初期値、運用計測後に再考。
3. `response_body` に CSV（数百 KB〜MB）を載せるか。 → MVP 用途では CSV ダウンロードに `Idempotency-Key` を要求しない方向で割り切る。
4. クリーンアップを summit cron / pg_cron どちらにするか。 → summit cron を第一候補。
5. multipart upload に対する hash 戦略（streaming hash か、一旦 buffer して hash か）。 → 上記対象外を採用したのでひとまず保留。
