# momo-result API DB契約

この文書は `momo-db` 側に追加したスキーマ契約です。MVP期間中、DBマイグレーションの正本はこのリポジトリではなく `momo-db` 側に置きます。

API / OCR worker は、以下の `momo-db` Drizzle マイグレーション済みテーブルをDB契約として参照します。

## momo-db レビュー結果

- migration: `momo-db` `drizzle/0007_opposite_adam_destine.sql`
- enum 値（screen type / job status / failure code）は DB CHECK では固定しません。API / worker 側の検証を正とし、DB は text として保持します。
- FK は張りません。`app_sessions.member_id`、`ocr_jobs.draft_id`、`ocr_drafts.job_id` の参照整合は API / worker 側のトランザクションとリポジトリ実装で保証してください。
- `ocr_drafts.job_id` と `ocr_jobs.draft_id` はそれぞれ UNIQUE にし、job / draft の 1:1 破壊をDBでも防ぎます。
- JSON はコンテナ型のみ DB CHECK します。`payload_json` / `timings_ms_json` は object、`warnings_json` は array です。

## 既存共有テーブル

- `members`
  - `id`
  - `user_id`（Discord user id）
  - `display_name`
- `held_events`

## `app_sessions`

Discord OAuth 完了後の server-side session を保持する。session id と `csrf_secret` は秘匿情報として扱い、ログに出力しない。

現行実装では以下を前提にする。

- OAuth user は `members.user_id`（Discord user id）で固定4名に照合する。
- `csrf_secret` は `/api/auth/me` で返す `csrfToken` として使い、状態変更APIの `X-CSRF-Token` と照合する。
- `expires_at` は session TTL（初期値30日）で更新し、認証成功時に `last_seen_at` とともに延長する。
- 期限切れ session は API 起動リソースの `ExpiredSessionPruner` が定期削除する。周期は `SESSION_PRUNE_INTERVAL_MINUTES` で設定する。
- `session-token-hardening` で session id / `csrf_secret` のDB保存をハッシュ化する予定。schema変更時は `deleteExpired` と session repository の検索・削除キーも同時に追従する。

```sql
CREATE TABLE app_sessions (
  id text PRIMARY KEY,
  member_id text NOT NULL,
  csrf_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX app_sessions_member_id_idx ON app_sessions(member_id);
CREATE INDEX app_sessions_expires_at_idx ON app_sessions(expires_at);
```

## `ocr_drafts`

```sql
CREATE TABLE ocr_drafts (
  id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE,
  requested_screen_type text NOT NULL,
  detected_screen_type text,
  profile_id text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  timings_ms_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_drafts_payload_json_object_check
    CHECK (jsonb_typeof(payload_json) = 'object'),
  CONSTRAINT ocr_drafts_warnings_json_array_check
    CHECK (jsonb_typeof(warnings_json) = 'array'),
  CONSTRAINT ocr_drafts_timings_ms_json_object_check
    CHECK (jsonb_typeof(timings_ms_json) = 'object')
);
```

## `ocr_jobs`

```sql
CREATE TABLE ocr_jobs (
  id text PRIMARY KEY,
  draft_id text NOT NULL,
  image_id text NOT NULL,
  image_path text NOT NULL,
  requested_screen_type text NOT NULL,
  detected_screen_type text,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  worker_id text,
  failure_code text,
  failure_message text,
  failure_retryable boolean,
  failure_user_action text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ocr_jobs_draft_id_unique ON ocr_jobs(draft_id);
CREATE INDEX ocr_jobs_status_created_at_idx ON ocr_jobs(status, created_at);
CREATE INDEX ocr_jobs_image_id_idx ON ocr_jobs(image_id);
```

`ocr_drafts.job_id` と `ocr_jobs.draft_id` は `UNIQUE` のみで、FK は張りません。API は空ドラフトを作成してからジョブを作成するため、参照整合は同一トランザクションのリポジトリ実装で保証してください。

## momo-result 試合結果系（migration `0008_foamy_nekra.sql` で追加）

業務要件は `docs/requirements/base.md` §5（試合結果） / §8.3（事件簿 6 項目固定） を参照。

### 共有テーブルへの変更

- `held_events.session_id` を **nullable** に変更。`unique` 制約は維持。
  - `NULL` のとき: momo-result が単独で作成した ad-hoc 開催履歴。
  - `NOT NULL` のとき: summit Discord 出席 session に紐づく開催履歴。
  - momo-result から `held_events` を作成する場合は **常に `session_id = NULL`** で挿入する。

### `matches`

```sql
CREATE TABLE matches (
  id text PRIMARY KEY,
  held_event_id text NOT NULL REFERENCES held_events(id) ON DELETE RESTRICT,
  match_no_in_event integer NOT NULL,
  game_title_id text NOT NULL REFERENCES game_titles(id) ON DELETE RESTRICT,
  layout_family text NOT NULL,
  season_master_id text NOT NULL REFERENCES season_masters(id) ON DELETE RESTRICT,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  map_master_id text NOT NULL REFERENCES map_masters(id) ON DELETE RESTRICT,
  played_at timestamptz NOT NULL,
  total_assets_draft_id text,
  revenue_draft_id text,
  incident_log_draft_id text,
  created_by_member_id text NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_match_no_in_event_check CHECK (match_no_in_event >= 1)
);

CREATE UNIQUE INDEX matches_event_match_no_unique ON matches(held_event_id, match_no_in_event);
CREATE INDEX matches_held_event_id_idx ON matches(held_event_id);
CREATE INDEX matches_played_at_idx ON matches(played_at);
```

- `(held_event_id, match_no_in_event)` で unique。同一開催内の 1-origin 連番。採番は `MAX(match_no_in_event) + 1` を API がデフォルト提示し、UI で上書き可能。
- `*_draft_id` は **FK ではなく文字列**。`ocr_drafts` は将来クリーンアップで削除されうるため、確定時の参照履歴メモとして保持する。
- `layout_family` は `game_titles.layout_family` の冗長コピー。作品名やプロファイル変更後も過去結果の OCR profile を追跡するため。
- `created_by_member_id` は確定操作を行ったログイン member。

### `match_players`

```sql
CREATE TABLE match_players (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  play_order integer NOT NULL,
  rank integer NOT NULL,
  total_assets_man_yen integer NOT NULL,
  revenue_man_yen integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, member_id),
  CONSTRAINT match_players_play_order_check CHECK (play_order BETWEEN 1 AND 4),
  CONSTRAINT match_players_rank_check CHECK (rank BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX match_players_match_play_order_unique ON match_players(match_id, play_order);
CREATE UNIQUE INDEX match_players_match_rank_unique ON match_players(match_id, rank);
```

- 4 行揃ったとき `play_order` / `rank` がそれぞれ集合 `{1,2,3,4}` を満たす。
- 金額は **万円単位の整数**。借金で **負も許容**するため値域 CHECK 無し。
- API は 1 試合 4 行を **同一トランザクション**で挿入する。

### `match_incidents`

```sql
CREATE TABLE match_incidents (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  incident_master_id text NOT NULL REFERENCES incident_masters(id) ON DELETE RESTRICT,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, member_id, incident_master_id),
  CONSTRAINT match_incidents_count_check CHECK (count >= 0)
);

CREATE INDEX match_incidents_match_id_idx ON match_incidents(match_id);
```

- MVP では 6 項目固定 × 4 player = 24 行 / 試合を挿入する。
- 0 回の項目も明示的に行を作る（「未入力 = 0」を集計側で前提にしない）。

### マスタ群

```sql
CREATE TABLE game_titles (
  id text PRIMARY KEY,
  name text NOT NULL,
  layout_family text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX game_titles_name_unique ON game_titles(name);

CREATE TABLE map_masters (
  id text PRIMARY KEY,
  game_title_id text NOT NULL REFERENCES game_titles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX map_masters_title_name_unique ON map_masters(game_title_id, name);

CREATE TABLE season_masters (
  id text PRIMARY KEY,
  game_title_id text NOT NULL REFERENCES game_titles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX season_masters_title_name_unique ON season_masters(game_title_id, name);

CREATE TABLE incident_masters (
  id text PRIMARY KEY,
  key text NOT NULL,
  display_name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX incident_masters_key_unique ON incident_masters(key);

CREATE TABLE member_aliases (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX member_aliases_member_alias_unique ON member_aliases(member_id, alias);
CREATE INDEX member_aliases_alias_idx ON member_aliases(alias);
```

`incident_masters` は migration `0008` で **MVP 6 項目を seed** 済み:

| id | key | display_name | display_order |
|---|---|---|---|
| `incident_destination` | `destination` | 目的地 | 1 |
| `incident_plus_station` | `plus_station` | プラス駅 | 2 |
| `incident_minus_station` | `minus_station` | マイナス駅 | 3 |
| `incident_card_station` | `card_station` | カード駅 | 4 |
| `incident_card_shop` | `card_shop` | カード売り場 | 5 |
| `incident_suri_no_ginji` | `suri_no_ginji` | スリの銀次 | 6 |

アプリ側はこの 6 項目固定として読み書きする。追加が必要になったら **新規 migration** で seed を追加する（既存 seed の `id` は不変）。

`game_titles` / `map_masters` / `season_masters` の初期データは MVP 範囲のマスタ管理 UI で投入する想定で、migration での seed は MVP 後に判断する。

### `member_aliases` の使い方

OCR worker が読み取った `raw_player_name` を API 側で alias 辞書引きして `members.id` に解決する。1 member に複数 alias を許容（unique は `(member_id, alias)`）。解決できないプレーヤー名は `match_players` に保存する前にユーザーが手動でマップする必要がある。

---

## トランザクション境界

| 操作 | 必須トランザクション |
|---|---|
| 試合確定 (`POST /api/matches`) | `matches` 1 行 + `match_players` 4 行 + `match_incidents` 24 行 を **同一 tx**。 |
| 開催履歴作成（momo-result 起点） | `held_events` 1 行のみ。`session_id = NULL`。 |
| マスタ追加 | 各テーブル 1 行ずつ。複数同時追加なら同一 tx。 |
| OCR ジョブ enqueue → 完了 | `ocr_jobs` の状態遷移は CAS。`ocr_drafts` 挿入と同 tx。 |

---

## 解決済み事項

- **`members` の seed**: momo-db `0009_seed_members.sql` で固定 4 名 (`member_ponta` / `member_akane_mami` / `member_otaka` / `member_eu`) を seed 済み。
- **マスタの `display_order` 採番**: API 側で作成時に `MAX(display_order) + 1` を採用。同時作成 race は許容し、`ORDER BY display_order, created_at, id` で安定化。
- **`game_titles` / `map_masters` / `season_masters` の初期データ投入**: マスタ管理 UI (`/admin/masters`) 経由で投入。migration による seed は行わない。
- **`layout_family` の信頼源**: API server 側で `game_titles.layout_family` を引いてコピーする。クライアント送信値は信頼しない。
- **`created_by_member_id` の取得元**: request body には含めず、認証 session の `AuthenticatedMember.memberId` から設定する。
- **試合の削除方式**: 修正履歴は保存しない方針と整合させ、物理削除で進める。`matches` 削除時は FK CASCADE で `match_players` / `match_incidents` も削除される。
- **CSV 出力の権限**: ログイン中 4 名すべてに許可。RLS は MVP では使用せず、API 層で session を確認する。
- **server-side session の有効期限削除ジョブ**: API 起動リソースとして実装済み。

## 未確定事項

- **session token hardening の移行方式**: `app_sessions.id` / `csrf_secret` のDB保存をハッシュ化する際、既存sessionを即時失効するか並行運用するかを決める。

---

## スキーマ変更フロー

1. 仕様変更を `docs/requirements/base.md` または `docs/requirements/system-design.md` に記述。
2. `momo-db/src/schema.ts` を編集。
3. `cd ../momo-db && pnpm build && pnpm db:generate` で migration 生成。
4. 必要に応じて生成された SQL に手動で seed / data migration を追記。
5. `pnpm db:check` で整合性確認。
6. `pnpm db:up && pnpm db:migrate` でローカル適用テスト。
7. momo-db の PR をマージ → master push で本番自動 migration。
8. `momo-result/apps/api/docs/db-contract.md`（本ファイル）を更新。
9. momo-result 側 API / OCR worker を新スキーマで実装。
