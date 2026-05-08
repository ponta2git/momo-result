package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryMapMastersRepository, InMemoryMatchesRepository,
  InMemoryMembersRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers, GameTitle, IncidentCounts, MapMaster, MatchRecord, Member, PlayerResult, SeasonMaster,
}
import momo.api.errors.AppError

final class ExportMatchesSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-06T20:00:00Z")
  private val heldEventId = HeldEventId("held_2026_05_06")
  private val titleId = GameTitleId("title_world")
  private val seasonId = SeasonMasterId("season_spring")
  private val mapId = MapMasterId("map_east")

  test("rejects invalid format before querying export data"):
    for
      usecase <- createUsecase()
      result <- usecase.run("xlsx", None, None, None)
    yield assertAppError(result, "VALIDATION_FAILED", "format must be one of")

  test("rejects multiple export scopes"):
    for
      usecase <- createUsecase()
      result <- usecase.run("csv", Some(seasonId), Some(heldEventId), None)
    yield assertAppError(result, "VALIDATION_FAILED", "Specify at most one export scope")

  test("returns not found for an unknown match scope"):
    for
      usecase <- createUsecase()
      result <- usecase.run("csv", None, None, Some(MatchId("missing")))
    yield assertAppError(result, "NOT_FOUND", "match was not found")

  test("builds a scoped TSV export with stable filename and content type"):
    for
      usecase <- createUsecaseWithMatch()
      result <- usecase.run("tsv", None, None, Some(MatchId("match-1")))
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

  private def createUsecase(): IO[ExportMatches[IO]] = createUsecaseSeeded(seedMatch = false)

  private def createUsecaseWithMatch(): IO[ExportMatches[IO]] =
    createUsecaseSeeded(seedMatch = true)

  private def createUsecaseSeeded(seedMatch: Boolean): IO[ExportMatches[IO]] =
    for
      matches <- InMemoryMatchesRepository.create[IO]
      members <- InMemoryMembersRepository.create[IO](List(
        member("ponta", "ponta"),
        member("akane-mami", "akane-mami"),
        member("otaka", "otaka"),
        member("eu", "eu"),
      ))
      gameTitles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      _ <- gameTitles.create(GameTitle(titleId, "World", "world", 1, now))
      _ <- maps.create(MapMaster(mapId, titleId, "East", 1, now))
      _ <- seasons.create(SeasonMaster(seasonId, titleId, "Spring", 1, now))
      _ <- if seedMatch then matches.create(matchRecord()) else IO.unit
    yield ExportMatches[IO](matches, members, maps, seasons)

  private def member(id: String, displayName: String): Member =
    Member(MemberId(id), UserId(id), displayName, now)

  private def matchRecord(): MatchRecord = MatchRecord(
    id = MatchId("match-1"),
    heldEventId = heldEventId,
    matchNoInEvent = 1,
    gameTitleId = titleId,
    layoutFamily = "world",
    seasonMasterId = seasonId,
    ownerMemberId = MemberId("ponta"),
    mapMasterId = mapId,
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      player("ponta", 1, 1),
      player("akane-mami", 2, 2),
      player("otaka", 3, 3),
      player("eu", 4, 4),
    ),
    createdByMemberId = MemberId("ponta"),
    createdAt = now,
  )

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult(
    memberId = MemberId(memberId),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = 100,
    revenueManYen = 50,
    incidents = IncidentCounts(0, 0, 0, 0, 0, 0),
  )

  private def assertAppError[A](
      result: Either[AppError, A],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
    case Left(error) =>
      assertEquals(error.code, expectedCode)
      assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
    case Right(value) => fail(s"expected $expectedCode, got success: $value")
