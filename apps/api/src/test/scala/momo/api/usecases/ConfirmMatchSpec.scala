package momo.api.usecases

import java.nio.file.Files
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryHeldEventsRepository, InMemoryMapMastersRepository,
  InMemoryMatchConfirmationRepository, InMemoryMatchDraftsRepository, InMemoryMatchesRepository,
  InMemorySeasonMastersRepository, LocalFsImageStore,
}
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, HeldEvent, IncidentCounts, MapMaster, PlayerResult, SeasonMaster}
import momo.api.errors.AppError

final class ConfirmMatchSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-06T00:00:00Z")
  private val heldEventId = HeldEventId("held_2026_05_06")
  private val titleId = GameTitleId("title_world")
  private val mapId = MapMasterId("map_east")
  private val seasonId = SeasonMasterId("season_spring")
  private val allowedMembers =
    Set(MemberId("ponta"), MemberId("akane-mami"), MemberId("otaka"), MemberId("eu"))

  test("confirms a valid match and persists the created record"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      result <- fixture.usecase.run(command(), MemberId("ponta"))
      found <- fixture.matches.find(MatchId("match-1"))
    yield
      assertEquals(result.map(_.id), Right(MatchId("match-1")))
      assertEquals(found.map(_.matchNoInEvent), Some(1))

  test("rejects invalid player ranks before persisting"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      bad = commandWithPlayers(List(
        player("ponta", 1, 1),
        player("akane-mami", 2, 1),
        player("otaka", 3, 3),
        player("eu", 4, 4),
      ))
      result <- fixture.usecase.run(bad, MemberId("ponta"))
      found <- fixture.matches.find(MatchId("match-1"))
    yield
      assertAppError(result, "VALIDATION_FAILED", "players.rank")
      assertEquals(found, None)

  test("rejects missing held event"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedMastersOnly()
      result <- fixture.usecase.run(command(), MemberId("ponta"))
    yield assertAppError(result, "NOT_FOUND", "held event was not found")

  test("rejects duplicate match number for the same held event"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      first <- fixture.usecase.run(command(), MemberId("ponta"))
      second <- fixture.usecase.run(commandWithMatchNo(1), MemberId("ponta"))
    yield
      assertEquals(first.map(_.matchNoInEvent), Right(1))
      assertAppError(second, "CONFLICT", "already exists for held event")

  test("rejects map and season that belong to a different game title"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.gameTitles.create(GameTitle(GameTitleId("title_japan"), "Japan", "japan", 2, now))
      result <- fixture.usecase
        .run(commandWithGameTitle(GameTitleId("title_japan")), MemberId("ponta"))
    yield assertAppError(result, "VALIDATION_FAILED", "mapMasterId")

  private def command(): ConfirmMatch.Command =
    commandWith(matchNoInEvent = 1, gameTitleId = titleId, players = defaultPlayers)

  private def commandWithMatchNo(matchNoInEvent: Int): ConfirmMatch.Command =
    commandWith(matchNoInEvent = matchNoInEvent, gameTitleId = titleId, players = defaultPlayers)

  private def commandWithGameTitle(gameTitleId: GameTitleId): ConfirmMatch.Command =
    commandWith(matchNoInEvent = 1, gameTitleId = gameTitleId, players = defaultPlayers)

  private def commandWithPlayers(players: List[PlayerResult]): ConfirmMatch.Command =
    commandWith(matchNoInEvent = 1, gameTitleId = titleId, players = players)

  private def commandWith(
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      players: List[PlayerResult],
  ): ConfirmMatch.Command = ConfirmMatch.Command(
    heldEventId = heldEventId,
    matchNoInEvent = matchNoInEvent,
    gameTitleId = gameTitleId,
    seasonMasterId = seasonId,
    ownerMemberId = MemberId("ponta"),
    mapMasterId = mapId,
    playedAt = "2026-05-06T20:00:00Z",
    matchDraftId = None,
    draftRefs = ConfirmMatch.DraftRefs(None, None, None),
    players = players,
  )

  private def defaultPlayers: List[PlayerResult] = List(
    player("ponta", 1, 1),
    player("akane-mami", 2, 2),
    player("otaka", 3, 3),
    player("eu", 4, 4),
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
  ): Unit =
    result match
      case Left(error) =>
        assertEquals(error.code, expectedCode)
        assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
      case Right(value) => fail(s"expected $expectedCode, got success: $value")

  private final case class Fixture(
      gameTitles: InMemoryGameTitlesRepository[IO],
      mapMasters: InMemoryMapMastersRepository[IO],
      seasonMasters: InMemorySeasonMastersRepository[IO],
      heldEvents: InMemoryHeldEventsRepository[IO],
      matches: InMemoryMatchesRepository[IO],
      usecase: ConfirmMatch[IO],
  ):
    def seedPrereqs(): IO[Unit] = seedMastersOnly() *> heldEvents.create(HeldEvent(heldEventId, now))

    def seedMastersOnly(): IO[Unit] =
      gameTitles.create(GameTitle(titleId, "World", "world", 1, now)) *>
        mapMasters.create(MapMaster(mapId, titleId, "East", 1, now)) *>
        seasonMasters.create(SeasonMaster(seasonId, titleId, "Spring", 1, now))

  private object Fixture:
    def create: IO[Fixture] =
      for
        dir <- IO.blocking(Files.createTempDirectory("momo-api-confirm-match"))
        gameTitles <- InMemoryGameTitlesRepository.create[IO]
        mapMasters <- InMemoryMapMastersRepository.create[IO]
        seasonMasters <- InMemorySeasonMastersRepository.create[IO]
        heldEvents <- InMemoryHeldEventsRepository.create[IO]
        matches <- InMemoryMatchesRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        retention = PurgeSourceImages[IO](matchDrafts, LocalFsImageStore[IO](dir))
        confirmations = InMemoryMatchConfirmationRepository[IO](matches, matchDrafts)
        ids <- IO.ref(List("match-1", "match-2"))
        usecase = ConfirmMatch[IO](
          heldEvents = heldEvents,
          matches = matches,
          matchDrafts = matchDrafts,
          confirmations = confirmations,
          sourceImageRetention = retention,
          gameTitles = gameTitles,
          mapMasters = mapMasters,
          seasonMasters = seasonMasters,
          now = IO.pure(now),
          nextId = ids.modify {
            case head :: tail => tail -> head
            case Nil => Nil -> "unexpected-match-id"
          },
          allowedMemberIds = allowedMembers,
        )
      yield Fixture(gameTitles, mapMasters, seasonMasters, heldEvents, matches, usecase)
