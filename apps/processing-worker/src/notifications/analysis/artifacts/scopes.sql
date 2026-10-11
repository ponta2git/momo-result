-- The immutable artifact has already passed the full publication validator. Transfer the
-- saved player metrics needed by notification decoding, without unrelated analytical cards.
-- JSON preserves the nested values and duplicate fields for the existing typed decoder.
SELECT artifact_id, left(season_master_id, 201) AS season_id,
  convert_to(json_build_object(
    'metricsByPlayer', convert_from(payload, 'UTF8')::json -> 'metricsByPlayer'
  )::text, 'UTF8') AS payload
FROM series_analysis_scope_aggregate_artifacts
WHERE artifact_id = ANY($1::text[])
  AND (scope_kind = 'overall' OR (scope_kind = 'season' AND season_master_id = ANY($2::text[])))
ORDER BY artifact_id, scope_key
