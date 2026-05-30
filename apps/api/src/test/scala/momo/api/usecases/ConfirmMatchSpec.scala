package momo.api.usecases

import java.time.Instant

import cats.effect.{IO, Resource}

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryHeldEventsRepository, InMemoryMapMastersRepository,
  InMemoryMatchConfirmationRepository, InMemoryMatchDraftsRepository, InMemoryMatchesRepository,
  InMemorySeasonMastersRepository, LocalFsImageStore,
}
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, PlayerResult}
import momo.api.errors.AppError
import momo.api.usecases.testing.MatchFixtures

final class ConfirmMatchSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-06T00:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held_2026_05_06")
  private val titleId = GameTitleId.unsafeFromString("title_world")
  private val mapId = MapMasterId.unsafeFromString("map_east")
  private val seasonId = SeasonMasterId.unsafeFromString("season_spring")
  private val playedAt = Instant.parse("2026-05-06T20:00:00Z")
  private val memberValues = MatchFixtures.DevMemberValues
  private val allowedMembers = MatchFixtures.allowedMembers(memberValues)

  test("confirms a valid match and persists the created record"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedPrereqs()
        result <- fixture.usecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
        found <- fixture.matches.find(MatchId.unsafeFromString("match-1"))
      yield
        assertEquals(result.map(_.id), Right(MatchId.unsafeFromString("match-1")))
        assertEquals(found.map(_.matchNoInEvent.value), Some(1))
    }

  test("rejects invalid player ranks before persisting"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedPrereqs()
        bad = commandWithPlayers(MatchFixtures.duplicateRankPlayerInputs(memberValues))
        result <- fixture.usecase
          .run(bad, AccountId.unsafeFromString("ponta"), Some(MemberId.unsafeFromString("ponta")))
        found <- fixture.matches.find(MatchId.unsafeFromString("match-1"))
      yield
        assertAppError(result, "VALIDATION_FAILED", "players.rank")
        assertEquals(found, None)
    }

  test("rejects missing held event"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedMastersOnly()
        result <- fixture.usecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield assertAppError(result, "NOT_FOUND", "held event was not found")
    }

  test("rejects duplicate match number for the same held event"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedPrereqs()
        first <- fixture.usecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
        second <- fixture.usecase.run(
          commandWithMatchNo(1),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield
        assertEquals(first.map(_.matchNoInEvent.value), Right(1))
        assertAppError(second, "CONFLICT", "already exists for held event")
    }

  test("rejects map and season that belong to a different game title"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedPrereqs()
        _ <- fixture.gameTitles
          .create(GameTitle(GameTitleId.unsafeFromString("title_japan"), "Japan", "japan", 2, now))
        result <- fixture.usecase.run(
          commandWithGameTitle(GameTitleId.unsafeFromString("title_japan")),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield assertAppError(result, "VALIDATION_FAILED", "mapMasterId")
    }

  private def command(): ConfirmMatch.Command =
    commandWith(matchNoInEvent = 1, gameTitleId = titleId, players = defaultPlayers)

  private def commandWithMatchNo(matchNoInEvent: Int): ConfirmMatch.Command =
    commandWith(matchNoInEvent = matchNoInEvent, gameTitleId = titleId, players = defaultPlayers)

  private def commandWithGameTitle(gameTitleId: GameTitleId): ConfirmMatch.Command =
    commandWith(matchNoInEvent = 1, gameTitleId = gameTitleId, players = defaultPlayers)

  private def commandWithPlayers(players: List[PlayerResult.Input]): ConfirmMatch.Command =
    commandWith(matchNoInEvent = 1, gameTitleId = titleId, players = players)

  private def commandWith(
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      players: List[PlayerResult.Input],
  ): ConfirmMatch.Command = ConfirmMatch.Command(
    heldEventId = heldEventId,
    matchNoInEvent = matchNoInEvent,
    gameTitleId = gameTitleId,
    seasonMasterId = seasonId,
    ownerMemberId = MemberId.unsafeFromString("ponta"),
    mapMasterId = mapId,
    playedAt = playedAt,
    matchDraftId = None,
    draftRefs = ConfirmMatch.DraftRefs(None, None, None),
    players = players,
  )

  private def defaultPlayers: List[PlayerResult.Input] = MatchFixtures
    .defaultPlayerInputs(memberValues)

  private def assertAppError[A](
      result: Either[AppError, A],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
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
    def seedPrereqs(): IO[Unit] = MatchFixtures.seedWorldPrereqs(
      heldEvents,
      gameTitles,
      mapMasters,
      seasonMasters,
      heldEventId,
      titleId,
      mapId,
      seasonId,
      now,
    )

    def seedMastersOnly(): IO[Unit] = MatchFixtures
      .seedWorldMasters(gameTitles, mapMasters, seasonMasters, titleId, mapId, seasonId, now)

  private object Fixture:
    def resource: Resource[IO, Fixture] = tempDirectory("momo-api-confirm-match").evalMap { dir =>
      for
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
            case head :: tail => tail -> MatchId.unsafeFromString(head)
            case Nil => Nil -> MatchId.unsafeFromString("unexpected-match-id")
          },
          allowedMemberIds = IO.pure(allowedMembers),
        )
      yield Fixture(gameTitles, mapMasters, seasonMasters, heldEvents, matches, usecase)
    }
