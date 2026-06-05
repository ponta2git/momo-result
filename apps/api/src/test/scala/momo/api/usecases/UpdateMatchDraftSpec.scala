package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryHeldEventsRepository, InMemoryMapMastersRepository,
  InMemoryMatchDraftsRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, MatchDraft, MatchDraftStatus}
import momo.api.testing.AppErrorAssertions.{assertAppError, assertRight}
import momo.api.usecases.testing.MatchFixtures

final class UpdateMatchDraftSpec extends MomoCatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-08T10:00:00Z")
  private val updatedAt = Instant.parse("2026-05-08T10:05:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held-update-draft")
  private val titleId = GameTitleId.unsafeFromString("title_world")
  private val otherTitleId = GameTitleId.unsafeFromString("title_japan")
  private val mapId = MapMasterId.unsafeFromString("map_east")
  private val seasonId = SeasonMasterId.unsafeFromString("season_spring")
  private val draftId = MatchDraftId.unsafeFromString("draft-update-1")

  test("updates editable draft fields for the owner and persists the timestamp"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(editingDraft(draftId, MatchDraftStatus.DraftReady))
      result <- fixture.usecase.run(
        draftId,
        blankCommand.copy(
          heldEventId = Some(heldEventId),
          matchNoInEvent = Some(2),
          gameTitleId = Some(titleId),
          layoutFamily = Some("world"),
          seasonMasterId = Some(seasonId),
          ownerMemberId = Some(MemberId.unsafeFromString("ponta")),
          mapMasterId = Some(mapId),
          playedAt = Some(updatedAt),
          status = Some(MatchDraftStatus.NeedsReview),
        ),
      )
      found <- fixture.matchDrafts.find(draftId)
    yield
      val updated = assertRight(result)
      assertEquals(updated.status, MatchDraftStatus.NeedsReview)
      assertEquals(updated.heldEventId, Some(heldEventId))
      assertEquals(updated.matchNoInEvent.map(_.value), Some(2))
      assertEquals(updated.layoutFamily, Some("world"))
      assertEquals(updated.updatedAt, updatedAt)
      assertEquals(found.map(_.status), Some(MatchDraftStatus.NeedsReview))
      assertEquals(found.map(_.updatedAt), Some(updatedAt))

  test("allows updates from accounts that did not create the draft"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(editingDraft(draftId, MatchDraftStatus.DraftReady))
      result <- fixture.usecase
        .run(draftId, blankCommand.copy(status = Some(MatchDraftStatus.NeedsReview)))
      found <- fixture.matchDrafts.find(draftId)
    yield
      val updated = assertRight(result)
      assertEquals(updated.status, MatchDraftStatus.NeedsReview)
      assertEquals(found.map(_.status), Some(MatchDraftStatus.NeedsReview))
      assertEquals(found.map(_.updatedAt), Some(updatedAt))

  test("rejects terminal drafts even when the requester owns them"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(confirmedDraft(draftId))
      result <- fixture.usecase.run(draftId, blankCommand.copy(matchNoInEvent = Some(2)))
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(result, "CONFLICT", "cannot be edited")
      assertEquals(found.map(_.status), Some(MatchDraftStatus.Confirmed))
      assertEquals(
        found.flatMap(_.confirmedMatchId),
        Some(MatchId.unsafeFromString("match-confirmed-1")),
      )

  test("rejects terminal status values from the update endpoint"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(editingDraft(draftId, MatchDraftStatus.DraftReady))
      terminal <- fixture.usecase
        .run(draftId, blankCommand.copy(status = Some(MatchDraftStatus.Confirmed)))
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(terminal, "CONFLICT", "cannot be set")
      assertEquals(found.map(_.status), Some(MatchDraftStatus.DraftReady))

  test("rejects map and season masters that do not belong to the supplied game title"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.gameTitles.create(GameTitle(otherTitleId, "Japan", "japan", 2, createdAt))
      _ <- fixture.matchDrafts.create(editingDraft(draftId, MatchDraftStatus.DraftReady))
      result <- fixture.usecase.run(
        draftId,
        blankCommand.copy(
          gameTitleId = Some(otherTitleId),
          mapMasterId = Some(mapId),
          seasonMasterId = Some(seasonId),
        ),
      )
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(result, "VALIDATION_FAILED", "mapMasterId")
      assertEquals(found.map(_.gameTitleId), Some(None))

  test("rejects partial updates whose effective references become inconsistent"):
    val otherMapId = MapMasterId.unsafeFromString("map_japan")
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.gameTitles.create(GameTitle(otherTitleId, "Japan", "japan", 2, createdAt))
      _ <- fixture.mapMasters.create(MapMaster(otherMapId, otherTitleId, "西日本編", 2, createdAt))
      _ <- fixture.matchDrafts.create(referencedDraft(draftId))
      titleChange <- fixture.usecase
        .run(draftId, blankCommand.copy(gameTitleId = Some(otherTitleId)))
      mapChange <- fixture.usecase.run(draftId, blankCommand.copy(mapMasterId = Some(otherMapId)))
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(titleChange, "VALIDATION_FAILED", "mapMasterId")
      assertAppError(mapChange, "VALIDATION_FAILED", "mapMasterId")
      assertEquals(found.flatMap(_.gameTitleId), Some(titleId))
      assertEquals(found.flatMap(_.mapMasterId), Some(mapId))

  private def blankCommand: UpdateMatchDraftCommand = UpdateMatchDraftCommand(
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    status = None,
  )

  private def editingDraft(id: MatchDraftId, status: MatchDraftStatus): MatchDraft =
    draft(id, status, confirmedMatchId = None)

  private def referencedDraft(id: MatchDraftId): MatchDraft = editingDraft(
    id,
    MatchDraftStatus.DraftReady,
  ).withCommon(
    _.copy(gameTitleId = Some(titleId), seasonMasterId = Some(seasonId), mapMasterId = Some(mapId))
  )

  private def confirmedDraft(id: MatchDraftId): MatchDraft = draft(
    id,
    MatchDraftStatus.Confirmed,
    confirmedMatchId = Some(MatchId.unsafeFromString("match-confirmed-1")),
  )

  private def draft(
      id: MatchDraftId,
      status: MatchDraftStatus,
      confirmedMatchId: Option[MatchId],
  ): MatchDraft = MatchDraft.fromInputs(
    id = id,
    createdByAccountId = AccountId.unsafeFromString("ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("ponta")),
    status = status,
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = confirmedMatchId,
    createdAt = createdAt,
    updatedAt = createdAt,
  ).getOrElse(fail(s"invalid draft fixture id=${id.value} status=${status.wire}"))

  private final case class Fixture(
      heldEvents: InMemoryHeldEventsRepository[IO],
      gameTitles: InMemoryGameTitlesRepository[IO],
      mapMasters: InMemoryMapMastersRepository[IO],
      seasonMasters: InMemorySeasonMastersRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      usecase: UpdateMatchDraft[IO],
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

  private object Fixture:
    def create: IO[Fixture] =
      for
        heldEvents <- InMemoryHeldEventsRepository.create[IO]
        gameTitles <- InMemoryGameTitlesRepository.create[IO]
        mapMasters <- InMemoryMapMastersRepository.create[IO]
        seasonMasters <- InMemorySeasonMastersRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        usecase = UpdateMatchDraft[IO](
          heldEvents = heldEvents,
          gameTitles = gameTitles,
          mapMasters = mapMasters,
          seasonMasters = seasonMasters,
          matchDrafts = matchDrafts,
          now = IO.pure(updatedAt),
        )
      yield Fixture(heldEvents, gameTitles, mapMasters, seasonMasters, matchDrafts, usecase)
