package momo.api.adapters.postgres

import java.time.Instant

import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

private[postgres] object PostgresSeriesAnalysisCampaignStatusOps:
  def refresh(campaignId: String, now: Instant): ConnectionIO[Unit] =
    for
      _ <- sql"""
        WITH counts AS (
          SELECT
            COUNT(*) FILTER (WHERE status <> 'pending')::int AS expanded_count,
            COUNT(*) FILTER (
              WHERE status IN ('succeeded', 'failed', 'skipped_title_deleted')
            )::int AS terminal_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE status = 'skipped_title_deleted')::int AS skipped_count
          FROM series_analysis_campaign_targets
          WHERE campaign_id = $campaignId
        )
        UPDATE series_analysis_campaigns c
        SET expanded_count = counts.expanded_count,
            terminal_count = counts.terminal_count,
            failed_count = counts.failed_count,
            skipped_count = counts.skipped_count,
            status = CASE
              WHEN counts.terminal_count = c.target_count THEN 'terminal'
              WHEN counts.expanded_count = c.target_count THEN 'running'
              ELSE 'expanding'
            END,
            finished_at = CASE
              WHEN counts.terminal_count = c.target_count THEN COALESCE(c.finished_at, $now)
              ELSE NULL
            END
        FROM counts
        WHERE c.id = $campaignId
      """.update.run
      _ <- sql"""
        UPDATE series_analysis_operation_requests o
        SET status = CASE WHEN c.status = 'terminal' THEN 'terminal' ELSE 'running' END,
            finished_at = CASE
              WHEN c.status = 'terminal' THEN COALESCE(o.finished_at, c.finished_at, $now)
              ELSE NULL
            END
        FROM series_analysis_campaigns c
        WHERE c.id = $campaignId
          AND o.id = c.operation_request_id
      """.update.run
    yield ()
