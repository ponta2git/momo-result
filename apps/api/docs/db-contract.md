# momo-result API DB契約

この文書は `momo-db` 側に追加したスキーマ契約です。MVP期間中、DBマイグレーションの正本はこのリポジトリではなく `momo-db` 側に置きます。

本フェーズの API はインメモリアダプタで動作します。PostgreSQL アダプタ実装時は、以下の `momo-db` Drizzle マイグレーション済みテーブルに接続してください。

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

## 次フェーズTODO

- 試合結果系: `match_results`, `match_result_players`, `match_result_incidents`
- マスタ系: 作品、マップ、シーズン、事件名、プレイヤー名エイリアス
- server-side session の有効期限削除ジョブ
