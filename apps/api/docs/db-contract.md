# momo-result API DB契約案

この文書は `momo-db` 側に追加してほしいスキーマ契約案です。MVP期間中、DBマイグレーションの正本はこのリポジトリではなく `momo-db` 側に置きます。

本フェーズの API はインメモリアダプタで動作します。PostgreSQL アダプタ実装前に、以下のテーブルを `momo-db` の Drizzle マイグレーションへ追加してください。

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
  member_id text NOT NULL REFERENCES members(id),
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
  CONSTRAINT ocr_drafts_requested_screen_type_check
    CHECK (requested_screen_type IN ('auto', 'total_assets', 'revenue', 'incident_log')),
  CONSTRAINT ocr_drafts_detected_screen_type_check
    CHECK (detected_screen_type IS NULL OR detected_screen_type IN ('total_assets', 'revenue', 'incident_log'))
);
```

## `ocr_jobs`

```sql
CREATE TABLE ocr_jobs (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES ocr_drafts(id),
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_jobs_requested_screen_type_check
    CHECK (requested_screen_type IN ('auto', 'total_assets', 'revenue', 'incident_log')),
  CONSTRAINT ocr_jobs_detected_screen_type_check
    CHECK (detected_screen_type IS NULL OR detected_screen_type IN ('total_assets', 'revenue', 'incident_log')),
  CONSTRAINT ocr_jobs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT ocr_jobs_failure_code_check
    CHECK (
      failure_code IS NULL OR failure_code IN (
        'TEMP_IMAGE_MISSING',
        'INVALID_IMAGE',
        'UNSUPPORTED_IMAGE_FORMAT',
        'IMAGE_TOO_LARGE',
        'DECODE_FAILED',
        'CATEGORY_UNDETECTED',
        'LAYOUT_UNSUPPORTED',
        'OCR_TIMEOUT',
        'OCR_ENGINE_UNAVAILABLE',
        'PARSER_FAILED',
        'DB_WRITE_FAILED',
        'QUEUE_FAILURE'
      )
    )
);

CREATE INDEX ocr_jobs_draft_id_idx ON ocr_jobs(draft_id);
CREATE INDEX ocr_jobs_status_created_at_idx ON ocr_jobs(status, created_at);
CREATE INDEX ocr_jobs_image_id_idx ON ocr_jobs(image_id);
```

`ocr_drafts.job_id` は `UNIQUE` のみで、FK は張りません。API は空ドラフトを作成してからジョブを作成するため、循環 FK を避け、`ocr_jobs.draft_id` の FK を正とします。

## 次フェーズTODO

- 試合結果系: `match_results`, `match_result_players`, `match_result_incidents`
- マスタ系: 作品、マップ、シーズン、事件名、プレイヤー名エイリアス
- server-side session の有効期限削除ジョブ
