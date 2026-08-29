package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{
  PostgresGameTitlesRepository,
  PostgresSeriesAnalysisHistoryMaintenance
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
          artifact_schema_version, status, trigger, requested_at, available_at, finished_at
        ) VALUES
          ('analysis-job-old-terminal', $titleId, 0, 'series-analysis-v1', 1,
           'failed', 'manual', ${cutoff.minusSeconds(60)}, ${cutoff.minusSeconds(
          60
        )}, ${cutoff.minusSeconds(1)}),
          ('analysis-job-fresh-terminal', $titleId, 0, 'series-analysis-v1', 1,
           'failed', 'manual', $cutoff, $cutoff, ${cutoff.plusSeconds(1)}),
          ('analysis-job-active', $titleId, 0, 'series-analysis-v1', 1,
           'queued', 'manual', ${cutoff.minusSeconds(60)}, ${cutoff.minusSeconds(60)}, NULL)
      """.update.run.transact(transactor)
      maintenance = PostgresSeriesAnalysisHistoryMaintenance[IO](transactor)
      counts <- maintenance.cleanupHistory(cutoff, now.minusSeconds(24L * 60L * 60L), 100)
      remaining <- sql"""
        SELECT id FROM series_analysis_jobs ORDER BY id
      """.query[String].to[List].transact(transactor)
    yield
      assertEquals(counts, SeriesAnalysisCleanupCounts(0, 0, 1, 0, 0))
      assertEquals(remaining, List("analysis-job-active", "analysis-job-fresh-terminal"))

end PostgresSeriesAnalysisHistoryMaintenanceSpec
