package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository,
  InMemoryHeldEventsRepository,
  InMemoryMapMastersRepository,
  InMemoryMatchesRepository,
  InMemorySeasonMastersRepository
}
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MatchNoInEvent, MatchRecord, PlayerResult}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.MatchesRepository
import momo.api.testing.AppErrorAssertions.{assertAppError, assertRight}
import momo.api.usecases.testing.MatchFixtures

final class UpdateMatchSpec extends MomoCatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-08T11:00:00Z")
  private val updatedAt = Instant.parse("2026-05-08T11:05:00Z")
  private val playedAt = Instant.parse("2026-05-08T20:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held-update-match")
  private val titleId = GameTitleId.unsafeFromString("title_world")
  private val otherTitleId = GameTitleId.unsafeFromString("title_japan")
  private val mapId = MapMasterId.unsafeFromString("map_east")
  private val seasonId = SeasonMasterId.unsafeFromString("season_spring")
  private val matchId = MatchId.unsafeFromString("match-update-1")
  private val memberValues = MatchFixtures.DevMemberValues
  private val allowedMembers = MatchFixtures.allowedMembers(memberValues)

  test("updates a match and preserves existing draft refs when the command omits them"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matches.create(sampleMatch(matchId, matchNoInEvent = 1))
      result <- fixture.usecase.run(
        matchId,
        command(
          matchNoInEvent = 2,
          gameTitleId = titleId,
          draftRefs = ConfirmMatch.DraftRefs(
            totalAssets = None,
            revenue = Some(OcrDraftId.unsafeFromString("draft-revenue-new")),
            incidentLog = None,
          ),
        ),
      )
      found <- fixture.matches.find(matchId)
    yield
      val updated = assertRight(result)
      assertEquals(updated.matchNoInEvent.value, 2)
      assertEquals(updated.layoutFamily, "world")
      assertEquals(updated.playedAt, playedAt)
      assertEquals(updated.totalAssetsDraftId, Some(OcrDraftId.unsafeFromString("draft-total-old")))
      assertEquals(updated.revenueDraftId, Some(OcrDraftId.unsafeFromString("draft-revenue-new")))
      assertEquals(
        updated.incidentLogDraftId,
        Some(OcrDraftId.unsafeFromString("draft-incident-old")),
      )
      assertEquals(found.map(_.matchNoInEvent.value), Some(2))

  test("rejects duplicate match number for the same held event before updating"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matches.create(sampleMatch(matchId, matchNoInEvent = 1))
      _ <- fixture.matches
        .create(sampleMatch(MatchId.unsafeFromString("match-update-2"), matchNoInEvent = 2))
      result <- fixture.usecase.run(matchId, command(matchNoInEvent = 2, gameTitleId = titleId))
      found <- fixture.matches.find(matchId)
    yield
      assertAppError(result, "CONFLICT", "already exists for held event")
      assertEquals(found.map(_.matchNoInEvent.value), Some(1))

  test("maps repository update conflicts into the usecase error channel"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matches.create(sampleMatch(matchId, matchNoInEvent = 1))
      conflictMatches = MatchesRepositoryWithUpdateConflict(fixture.matches)
      usecase = fixture.usecaseWith(conflictMatches)
      result <- usecase.run(matchId, command(matchNoInEvent = 2, gameTitleId = titleId))
    yield assertAppError(result, "CONFLICT", "repository conflict")

  test("rejects map and season masters that do not belong to the supplied game title"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.gameTitles.create(GameTitle(otherTitleId, "Japan", "japan", 2, createdAt))
      _ <- fixture.matches.create(sampleMatch(matchId, matchNoInEvent = 1))
      result <- fixture.usecase
        .run(matchId, command(matchNoInEvent = 2, gameTitleId = otherTitleId))
      found <- fixture.matches.find(matchId)
    yield
      assertAppError(result, "VALIDATION_FAILED", "mapMasterId")
      assertEquals(found.map(_.gameTitleId), Some(titleId))

  test("rejects invalid player ranks and leaves the existing record unchanged"):
    val badPlayers = MatchFixtures.duplicateRankPlayerInputs(memberValues)
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matches.create(sampleMatch(matchId, matchNoInEvent = 1))
      result <- fixture.usecase
        .run(matchId, command(matchNoInEvent = 2, gameTitleId = titleId).copy(players = badPlayers))
      found <- fixture.matches.find(matchId)
    yield
      assertAppError(result, "VALIDATION_FAILED", "players.rank")
      assertEquals(found.map(_.matchNoInEvent.value), Some(1))

  private def command(
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      draftRefs: ConfirmMatch.DraftRefs,
  ): UpdateMatch.Command = UpdateMatch.Command(
    heldEventId = heldEventId,
    matchNoInEvent = matchNoInEvent,
    gameTitleId = gameTitleId,
    seasonMasterId = seasonId,
    ownerMemberId = MemberId.unsafeFromString("ponta"),
    mapMasterId = mapId,
    playedAt = playedAt,
    draftRefs = draftRefs,
    players = defaultPlayers,
  )

  private def command(matchNoInEvent: Int, gameTitleId: GameTitleId): UpdateMatch.Command =
    command(matchNoInEvent, gameTitleId, ConfirmMatch.DraftRefs(None, None, None))

  private def sampleMatch(id: MatchId, matchNoInEvent: Int): MatchRecord = MatchFixtures
    .matchRecord(
      id = id,
      heldEventId = heldEventId,
      matchNoInEvent = matchNoInEvent,
      titleId = titleId,
      seasonId = seasonId,
      mapId = mapId,
      playedAt = createdAt,
      createdAt = createdAt,
      memberValues = memberValues,
      totalAssetsDraftId = Some(OcrDraftId.unsafeFromString("draft-total-old")),
      revenueDraftId = None,
      incidentLogDraftId = Some(OcrDraftId.unsafeFromString("draft-incident-old")),
    )

  private def defaultPlayers: List[PlayerResult.Input] = MatchFixtures
    .defaultPlayerInputs(memberValues)

  private final case class Fixture(
      heldEvents: InMemoryHeldEventsRepository[IO],
      gameTitles: InMemoryGameTitlesRepository[IO],
      mapMasters: InMemoryMapMastersRepository[IO],
      seasonMasters: InMemorySeasonMastersRepository[IO],
      matches: InMemoryMatchesRepository[IO],
      usecase: UpdateMatch[IO],
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
      createdAt,
    )

    def usecaseWith(matchesRepository: MatchesRepository[IO]): UpdateMatch[IO] = UpdateMatch[IO](
      heldEvents = heldEvents,
      matches = matchesRepository,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = IO.pure(updatedAt),
      allowedMemberIds = IO.pure(allowedMembers),
    )

  private object Fixture:
    def create: IO[Fixture] =
      for
        heldEvents <- InMemoryHeldEventsRepository.create[IO]
        gameTitles <- InMemoryGameTitlesRepository.create[IO]
        mapMasters <- InMemoryMapMastersRepository.create[IO]
        seasonMasters <- InMemorySeasonMastersRepository.create[IO]
        matches <- InMemoryMatchesRepository.create[IO]
        usecase = UpdateMatch[IO](
          heldEvents = heldEvents,
          matches = matches,
          gameTitles = gameTitles,
          mapMasters = mapMasters,
          seasonMasters = seasonMasters,
          now = IO.pure(updatedAt),
          allowedMemberIds = IO.pure(allowedMembers),
        )
      yield Fixture(heldEvents, gameTitles, mapMasters, seasonMasters, matches, usecase)

  private final class MatchesRepositoryWithUpdateConflict(delegate: MatchesRepository[IO])
      extends MatchesRepository[IO]:
    override def create(record: MatchRecord): IO[Unit] = delegate.create(record)
    override def update(record: MatchRecord, updatedAt: Instant): IO[Unit] = IO
      .raiseError(new AppException(AppError.Conflict("repository conflict")))
    override def delete(id: MatchId): IO[Boolean] = delegate.delete(id)
    override def find(id: MatchId): IO[Option[MatchRecord]] = delegate.find(id)
    override def list(filter: MatchesRepository.ListFilter): IO[List[MatchRecord]] = delegate
      .list(filter)
    override def listByHeldEvent(heldEventId: HeldEventId): IO[List[MatchRecord]] = delegate
      .listByHeldEvent(heldEventId)
    override def existsMatchNo(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
    ): IO[Boolean] = delegate.existsMatchNo(heldEventId, matchNoInEvent)
    override def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
        excludeMatchId: MatchId,
    ): IO[Boolean] = IO.pure(false)
    override def maxMatchNo(heldEventId: HeldEventId): IO[Int] = delegate.maxMatchNo(heldEventId)
    override def countByHeldEvents(heldEventIds: List[HeldEventId]): IO[Map[HeldEventId, Int]] =
      delegate.countByHeldEvents(heldEventIds)

  private object MatchesRepositoryWithUpdateConflict:
    def apply(delegate: MatchesRepository[IO]): MatchesRepositoryWithUpdateConflict =
      new MatchesRepositoryWithUpdateConflict(delegate)
