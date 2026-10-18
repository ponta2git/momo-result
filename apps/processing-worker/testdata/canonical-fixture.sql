-- Synthetic test identities only. Production references resolve their stored aliases.
CREATE OR REPLACE FUNCTION pg_temp.fixture_uuid(entity text, legacy text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT AS $fixture$
DECLARE bytes bytea;
BEGIN
  IF entity <> ALL (ARRAY['members','member_aliases','momo_login_accounts','sessions','responses','held_events','game_titles','map_masters','season_masters','incident_masters','matches','match_drafts','source_images','ocr_jobs','ocr_drafts','ocr_submissions','series_analysis_operation_requests','series_analysis_campaigns','series_analysis_job_requests','series_analysis_jobs','series_analysis_job_attempts','series_analysis_artifacts','series_radar_bases','series_radar_candidates','series_radar_operations','series_radar_previews']) THEN
    RAISE EXCEPTION 'unknown fixture identity entity';
  END IF;
  BEGIN
    RETURN legacy::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    bytes := substring(sha256(decode('deabc659a5ca4dc09711eae0614fa478', 'hex')
      || convert_to(entity, 'UTF8') || decode('00', 'hex') || convert_to(legacy, 'UTF8')) FROM 1 FOR 16);
    bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 128);
    bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
    RETURN encode(bytes, 'hex')::uuid;
  END;
END
$fixture$;
