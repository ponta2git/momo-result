WITH supported AS (
  SELECT s.game_title_id,
    CASE WHEN current.status = 'published'
      AND current.artifact_schema_version = $1 AND current.validation_contract_id = $2
      THEN s.current_artifact_id END AS current_artifact_id,
    CASE WHEN previous.status = 'published'
      AND previous.artifact_schema_version = $1 AND previous.validation_contract_id = $2
      THEN s.previous_artifact_id END AS previous_artifact_id
  FROM series_analysis_title_states s
  LEFT JOIN series_analysis_artifacts current ON current.id = s.current_artifact_id
  LEFT JOIN series_analysis_artifacts previous ON previous.id = s.previous_artifact_id
  WHERE s.game_title_id = ANY($3)
)
UPDATE series_analysis_title_states s
SET current_artifact_id = supported.current_artifact_id,
    previous_artifact_id = supported.previous_artifact_id
FROM supported
WHERE s.game_title_id = supported.game_title_id
  AND (s.current_artifact_id IS DISTINCT FROM supported.current_artifact_id
    OR s.previous_artifact_id IS DISTINCT FROM supported.previous_artifact_id)
