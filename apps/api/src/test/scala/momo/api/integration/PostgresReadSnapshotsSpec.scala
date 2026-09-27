package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.adapters.postgres.{
  PostgresGameTitlesRepository,
  PostgresHeldEventsRepository,
  PostgresSeriesAnalysisRepository
}
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.ids.{GameTitleId, HeldEventId}
import momo.api.domain.{GameTitle, HeldEvent, PageRequest}

final class PostgresReadSnapshotsSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-09-01T00:00:00Z")

  test("held-event page count and rows share a read-only repeatable-read transaction"):
    val earlier = HeldEvent(HeldEventId.unsafeFromString("snapshot-earlier"), now)
    val later = HeldEvent(HeldEventId.unsafeFromString("snapshot-later"), now.plusSeconds(1))
    for
      _ <- PostgresHeldEventsRepository[IO](transactor).create(earlier)
      _ <- PostgresHeldEventsRepository[IO](transactor).create(later)
      page <- assertReadSnapshot(xa =>
        PostgresHeldEventsRepository[IO](xa).listPage(None, PageRequest(1, 1))
      )
    yield
      assertEquals(page.totalItems, 2)
      assertEquals(page.items, List(later))
      assertEquals(page.hasNextPage, true)

  test("analysis overview pins options, job history, audit and selected status to one snapshot"):
    val title =
      GameTitle(GameTitleId.unsafeFromString("snapshot-analysis"), "Snapshot", "world", 1, now)
    for
      _ <- PostgresGameTitlesRepository[IO](transactor).createWithNextDisplayOrder(title)
      result <- assertReadSnapshot(xa =>
        PostgresSeriesAnalysisRepository.create[IO](xa, SeriesAnalysisReadConfig.defaults)
          .flatMap(_.adminOverview(Some(title.id)))
      )
    yield
      val overview = result.fold(error => fail(error.code), identity)
      assertEquals(overview.titleOptions.map(_.gameTitleId), List(title.id))
      assertEquals(overview.selectedTitle.map(_.gameTitleId), Some(title.id))
      assertEquals(overview.recentJobs, Nil)
