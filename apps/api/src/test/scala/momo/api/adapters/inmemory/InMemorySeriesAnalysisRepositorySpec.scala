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
      ids = List.range(0, 11).map(index => GameTitleId.unsafeFromString(s"title-recent-$index"))
      _ <- ids.zipWithIndex.traverse_ { (id, index) =>
        titles.createWithNextDisplayOrder(GameTitle(id, s"履歴確認作品$index", "momotetsu2", index, now))
          .map(_.fold(error => fail(s"failed to create title: $error"), _ => ()))
      }
      repository <- InMemorySeriesAnalysisRepository.create[IO](titles, IO.pure(now))
      firstNine <- ids.take(9).traverse(id =>
        repository.requestTitleRecalculation(id, accountId, s"request-${id.value}")
      )
      belowLimit <- repository.adminOverview(None)
      lastTwo <- ids.drop(9).traverse(id =>
        repository.requestTitleRecalculation(id, accountId, s"request-${id.value}")
      )
      aboveLimit <- repository.adminOverview(None)
    yield
      val firstNineIds = firstNine.map(acceptedJobId)
      val allIds = firstNineIds ++ lastTwo.map(acceptedJobId)
      assertEquals(recentJobIds(belowLimit), firstNineIds.reverse)
      assertEquals(recentJobIds(aboveLimit), allIds.reverse.take(10))

  test(
    "concurrent retries share one operation and distinct operations coalesce into the queued job"
  ):
    val otherTitleId = GameTitleId.unsafeFromString("title-analysis-other")
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      _ <- titles.createWithNextDisplayOrder(GameTitle(titleId, "作品", "momotetsu2", 1, now))
      _ <- titles.createWithNextDisplayOrder(GameTitle(otherTitleId, "別作品", "momotetsu2", 2, now))
      repository <- InMemorySeriesAnalysisRepository.create[IO](titles, IO.pure(now))
      retries <- List.fill(8)(repository.requestTitleRecalculation(
        titleId,
        accountId,
        "same-key"
      )).parSequence
      firstOverview <- repository.adminOverview(Some(titleId))
      mismatch <- repository.requestTitleRecalculation(otherTitleId, accountId, "same-key")
      fresh <- repository.requestTitleRecalculation(titleId, accountId, "new-key")
      overview <- repository.adminOverview(Some(titleId))
    yield
      val accepted = retries.map(_.fold(error => fail(s"request failed: $error"), identity))
      assertEquals(accepted.map(_.requestId).distinct.size, 1)
      assertEquals(accepted.map(_.target.flatMap(_.jobId)).distinct.size, 1)
      assertEquals(firstOverview.map(_.recentJobs.map(_.manualRequestCount)), Right(List(1)))
      assertEquals(mismatch.left.toOption.map(_.code), Some("IDEMPOTENCY_PAYLOAD_MISMATCH"))
      assertEquals(acceptedJobId(fresh), acceptedJobId(retries.head))
      assertEquals(
        fresh.map(_.target.map(_.requestDisposition)),
        Right(Some("coalesced_into_queued_job"))
      )
      assertEquals(overview.map(_.recentJobs.map(_.manualRequestCount)), Right(List(2)))

  test("all-title retries keep one accepted campaign and its original target snapshot"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      _ <- titles.createWithNextDisplayOrder(GameTitle(titleId, "作品", "momotetsu2", 1, now))
      repository <- InMemorySeriesAnalysisRepository.create[IO](titles, IO.pure(now))
      retries <- List.fill(8)(repository.requestAllRecalculation(accountId, "all-key")).parSequence
      _ <- titles.createWithNextDisplayOrder(GameTitle(
        GameTitleId.unsafeFromString("title-added-later"),
        "後から追加",
        "momotetsu2",
        2,
        now,
      ))
      replay <- repository.requestAllRecalculation(accountId, "all-key")
      overview <- repository.adminOverview(None)
    yield
      val accepted = retries.map(_.fold(error => fail(s"request failed: $error"), identity))
      assertEquals(accepted.map(_.requestId).distinct.size, 1)
      assertEquals(replay, retries.head)
      assertEquals(replay.map(_.targetCount), Right(1))
      assertEquals(overview.map(_.globalExecution.activeCampaignCount), Right(1))
      assertEquals(overview.map(_.globalExecution.queuedTitleCount), Right(0))
      assertEquals(overview.map(_.recentJobs), Right(Nil))

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
