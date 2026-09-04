package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.domain.{GameTitle, SeriesAnalysisAdminOverview, SeriesAnalysisRecalculationAccepted}
import momo.api.errors.AppError

final class InMemorySeriesAnalysisRepositorySpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-09-04T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title-analysis-recent-jobs")
  private val accountId = AccountId.unsafeFromString("account-analysis-recent-jobs")

  test("admin overview keeps every job below the limit and only the latest ten above it"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      _ <- titles
        .createWithNextDisplayOrder(GameTitle(titleId, "履歴確認作品", "momotetsu2", 1, now))
        .map(_.fold(error => fail(s"failed to create title: $error"), _ => ()))
      repository <- InMemorySeriesAnalysisRepository.create[IO](titles, IO.pure(now))
      firstNine <- List.range(0, 9).traverse(index =>
        repository.requestTitleRecalculation(titleId, accountId, s"request-$index")
      )
      belowLimit <- repository.adminOverview(Some(titleId))
      lastTwo <- List.range(9, 11).traverse(index =>
        repository.requestTitleRecalculation(titleId, accountId, s"request-$index")
      )
      aboveLimit <- repository.adminOverview(Some(titleId))
    yield
      val firstNineIds = firstNine.map(acceptedJobId)
      val allIds = firstNineIds ++ lastTwo.map(acceptedJobId)
      assertEquals(recentJobIds(belowLimit), firstNineIds.reverse)
      assertEquals(recentJobIds(aboveLimit), allIds.reverse.take(10))

  private def acceptedJobId(
      result: Either[AppError, SeriesAnalysisRecalculationAccepted]
  ): String = result match
    case Right(accepted) => accepted.target.flatMap(_.jobId).getOrElse(fail("job ID is missing"))
    case Left(error) => fail(s"recalculation was rejected: $error")

  private def recentJobIds(
      result: Either[AppError, SeriesAnalysisAdminOverview]
  ): List[String] = result match
    case Right(overview) => overview.recentJobs.map(_.jobId)
    case Left(error) => fail(s"admin overview failed: $error")
