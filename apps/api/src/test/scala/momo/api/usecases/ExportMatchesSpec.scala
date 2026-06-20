package momo.api.usecases

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryMapMastersRepository, InMemoryMatchesRepository,
  InMemoryMembersRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.*
import momo.api.domain.{MatchExportFormat, MatchExportScope, MatchRecord}
import momo.api.testing.AppErrorAssertions.assertAppError
import momo.api.usecases.testing.MatchFixtures

final class ExportMatchesSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-06T20:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held_2026_05_06")
  private val titleId = GameTitleId.unsafeFromString("title_world")
  private val seasonId = SeasonMasterId.unsafeFromString("season_spring")
  private val mapId = MapMasterId.unsafeFromString("map_east")
  private val memberValues = MatchFixtures.DevMemberValues
  private val generousLimits = ExportMatches.Limits(maxRows = 20000, maxBytes = Long.MaxValue)

  test("returns not found for an unknown match scope"):
    for
      usecase <- createUsecase()
      result <- usecase
        .run(MatchExportFormat.Csv, MatchExportScope.Match(MatchId.unsafeFromString("missing")))
    yield assertAppError(result, "NOT_FOUND", "match was not found")

  test("builds a scoped TSV export with stable filename and content type"):
    for
      usecase <- createUsecaseWithMatch()
      result <- usecase
        .run(MatchExportFormat.Tsv, MatchExportScope.Match(MatchId.unsafeFromString("match-1")))
    yield
      val file = result.getOrElse(fail(s"expected export file, got $result"))
      assertEquals(file.fileName, "momo-results-match-match-1.tsv")
      assertEquals(file.contentType, "text/tab-separated-values; charset=utf-8")
      assertEquals(
        file.body,
        "シーズン\tシーズンNo.\tオーナー\tマップ\t対戦日\t対戦No.\tプレー順\tプレーヤー名\t順位\t総資産\t収益\t目的地\tプラス駅\tマイナス駅\tカード駅\tカード売り場\tスリの銀次\r\n" +
          "Spring\t1\tponta\tEast\t2026-05-07\t1\t1\tponta\t1\t100\t50\t0\t0\t0\t0\t0\t0\r\n" +
          "Spring\t1\tponta\tEast\t2026-05-07\t1\t2\takane-mami\t2\t100\t50\t0\t0\t0\t0\t0\t0\r\n" +
          "Spring\t1\tponta\tEast\t2026-05-07\t1\t3\totaka\t3\t100\t50\t0\t0\t0\t0\t0\t0\r\n" +
          "Spring\t1\tponta\tEast\t2026-05-07\t1\t4\teu\t4\t100\t50\t0\t0\t0\t0\t0\t0\r\n",
      )

  test("rejects an export when rendered rows exceed the configured row limit"):
    for
      usecase <- createUsecaseWithMatches(
        count = 2,
        limits = ExportMatches.Limits(maxRows = 5, maxBytes = Long.MaxValue),
      )
      result <- usecase.run(MatchExportFormat.Csv, MatchExportScope.All)
    yield assertAppError(result, "PAYLOAD_TOO_LARGE", "exceeding the configured limit of 5 rows")

  test("rejects an export when rendered bytes exceed the configured byte limit"):
    for
      usecase <- createUsecaseWithMatches(count = 1, limits = generousLimits.copy(maxBytes = 10L))
      result <- usecase.run(MatchExportFormat.Csv, MatchExportScope.All)
    yield assertAppError(result, "PAYLOAD_TOO_LARGE", "exceeding the configured limit of 10 bytes")

  private def createUsecase(): IO[ExportMatches[IO]] = createUsecaseSeeded(seedMatch = false)

  private def createUsecaseWithMatch(): IO[ExportMatches[IO]] =
    createUsecaseSeeded(seedMatch = true)

  private def createUsecaseSeeded(seedMatch: Boolean): IO[ExportMatches[IO]] =
    createUsecaseWithMatches(count = if seedMatch then 1 else 0, limits = generousLimits)

  private def createUsecaseWithMatches(
      count: Int,
      limits: ExportMatches.Limits,
  ): IO[ExportMatches[IO]] =
    for
      matches <- InMemoryMatchesRepository.create[IO]
      members <- InMemoryMembersRepository.create[IO](MatchFixtures.members(memberValues, now))
      gameTitles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      _ <- MatchFixtures.seedWorldMasters(gameTitles, maps, seasons, titleId, mapId, seasonId, now)
      _ <- (1 to count).toList.traverse_(index => matches.create(matchRecord(index)))
    yield ExportMatches[IO](matches, members, maps, seasons, limits)

  private def matchRecord(index: Int): MatchRecord = MatchFixtures.matchRecord(
    id = MatchId.unsafeFromString(s"match-$index"),
    heldEventId = heldEventId,
    matchNoInEvent = index,
    titleId = titleId,
    seasonId = seasonId,
    mapId = mapId,
    playedAt = now.plusSeconds(index.toLong),
    createdAt = now.plusSeconds(index.toLong),
    memberValues = memberValues,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
  )
