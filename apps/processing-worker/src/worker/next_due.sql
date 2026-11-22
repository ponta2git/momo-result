SELECT EXTRACT(EPOCH FROM LEAST(
    (SELECT MIN(available_at) FROM ocr_jobs
     WHERE $4 AND status = 'queued' AND available_at > statement_timestamp()),
    (SELECT MIN(available_at) FROM series_analysis_jobs
     WHERE $5 AND status = 'queued' AND available_at > statement_timestamp()
       AND algorithm_version = $1 AND artifact_schema_version = $2::bigint::integer AND validation_contract_id = $3),
    -- A cutoff may pass between the repair scan and this query. Keep that work on the
    -- active maintenance cadence, including lock contention, without scheduling a tight loop.
    (SELECT CASE WHEN stale_at <= statement_timestamp() THEN statement_timestamp() + interval '30 seconds'
                 ELSE stale_at END
     FROM (SELECT MIN(COALESCE(started_at, created_at)) + $6 * interval '1 second' AS stale_at
           FROM ocr_jobs
           WHERE $4 AND status IN ('queued', 'running')
             AND (lease_expires_at IS NULL OR lease_expires_at <= statement_timestamp())) AS stale),
    (SELECT MIN(lease_expires_at) FROM ocr_jobs
     WHERE status = 'running' AND lease_expires_at > statement_timestamp()),
    (SELECT MIN(lease_expires_at) FROM series_analysis_jobs
     WHERE status = 'running' AND lease_expires_at > statement_timestamp())
) - statement_timestamp())::double precision
