package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{
  PostgresGameTitlesRepository,
  PostgresSeriesAnalysisHistoryMaintenance,
  SeriesAnalysisArtifactSupport
}
import momo.api.domain.GameTitle
import momo.api.domain.ids.GameTitleId
import momo.api.repositories.SeriesAnalysisCleanupCounts

final class PostgresSeriesAnalysisHistoryMaintenanceSpec extends IntegrationSuite:
  private val now = Instant.parse("2099-08-09T12:00:00Z")
  private val cutoff = now.minusSeconds(45L * 24L * 60L * 60L)
  private val titleId = GameTitleId.unsafeFromString("title-analysis-history")

  test("prunes only terminal analysis history older than the supplied boundary"):
    for
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(titleId, "分析履歴作品", "momotetsu2", 1, now))
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id, status, trigger,
          requested_at, available_at, finished_at
        ) VALUES
          ('analysis-job-old-terminal', $titleId, 0, 'series-analysis-v1', 2,
           ${SeriesAnalysisArtifactSupport.ValidationContractId}, 'failed', 'manual',
           ${cutoff.minusSeconds(60)}, ${cutoff.minusSeconds(
          60
        )}, ${cutoff.minusSeconds(1)}),
          ('analysis-job-fresh-terminal', $titleId, 0, 'series-analysis-v1', 1,
           NULL, 'failed', 'manual', $cutoff, $cutoff, ${cutoff.plusSeconds(1)}),
          ('analysis-job-active', $titleId, 0, 'series-analysis-v1', 1,
           NULL, 'queued', 'manual', ${cutoff.minusSeconds(60)},
           ${cutoff.minusSeconds(60)}, NULL)
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO series_analysis_job_attempts (
          id, job_id, attempt_no, owner, fencing_token, input_revision,
          algorithm_version, artifact_schema_version, validation_contract_id,
          status, outcome, effective_config_version,
          calculation_timeout_milliseconds, finished_at
        ) VALUES (
          'analysis-attempt-old-terminal', 'analysis-job-old-terminal', 1,
          'history-maintenance-test', 1, 0, 'series-analysis-v1', 2,
          ${SeriesAnalysisArtifactSupport.ValidationContractId}, 'terminal', 'failed',
          'history-maintenance-test', 1000, ${cutoff.minusSeconds(1)}
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO series_analysis_artifacts (
          id, game_title_id, attempt_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id, source_input_checksum,
          root_checksum, status, aggregate_chunk_count, review_chunk_count,
          drilldown_chunk_count, match_context_chunk_count, encoded_bytes,
          decoded_bytes, created_at
        ) VALUES (
          'analysis-artifact-old-sealed', $titleId, 'analysis-attempt-old-terminal',
          0, 'series-analysis-v1', 2, NULL, ${"sha256:" + "0" * 64},
          ${"sha256:" + "1" * 64}, 'staging', 1, 0, 0, 0, 2, 2,
          ${cutoff.minusSeconds(60)}
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO series_analysis_scope_aggregate_artifacts (
          artifact_id, scope_key, scope_kind, payload, encoded_bytes,
          decoded_bytes, item_count, nesting_depth, checksum
        ) VALUES (
          'analysis-artifact-old-sealed', 'overall', 'overall',
          decode('7b7d', 'hex'), 2, 2, 0, 1,
          ${"sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        UPDATE series_analysis_artifacts
        SET validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
        WHERE id = 'analysis-artifact-old-sealed'
      """.update.run.transact(transactor)
      maintenance = PostgresSeriesAnalysisHistoryMaintenance[IO](transactor)
      counts <- maintenance.cleanupHistory(cutoff, now.minusSeconds(24L * 60L * 60L), 100)
      remaining <- sql"""
        SELECT id FROM series_analysis_jobs ORDER BY id
      """.query[String].to[List].transact(transactor)
      sealedArtifactRows <- sql"""
        SELECT
          (SELECT COUNT(*)::int FROM series_analysis_artifacts
           WHERE id = 'analysis-artifact-old-sealed'),
          (SELECT COUNT(*)::int FROM series_analysis_scope_aggregate_artifacts
           WHERE artifact_id = 'analysis-artifact-old-sealed')
      """.query[(Int, Int)].unique.transact(transactor)
    yield
      assertEquals(counts, SeriesAnalysisCleanupCounts(0, 0, 1, 1, 0))
      assertEquals(remaining, List("analysis-job-active", "analysis-job-fresh-terminal"))
      assertEquals(sealedArtifactRows, (0, 0))

end PostgresSeriesAnalysisHistoryMaintenanceSpec
