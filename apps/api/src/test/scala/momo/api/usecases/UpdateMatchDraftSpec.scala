package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryHeldEventsRepository, InMemoryMapMastersRepository,
  InMemoryMatchDraftsRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MatchDraft, MatchDraftStatus}
import momo.api.errors.AppError
import momo.api.usecases.testing.MatchFixtures

final class UpdateMatchDraftSpec extends MomoCatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-08T10:00:00Z")
  private val updatedAt = Instant.parse("2026-05-08T10:05:00Z")
  private val heldEventId = HeldEventId("held-update-draft")
  private val titleId = GameTitleId("title_world")
  private val otherTitleId = GameTitleId("title_japan")
  private val mapId = MapMasterId("map_east")
  private val seasonId = SeasonMasterId("season_spring")
  private val draftId = MatchDraftId("draft-update-1")

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
          ownerMemberId = Some(MemberId("ponta")),
          mapMasterId = Some(mapId),
          playedAt = Some(updatedAt),
          status = Some("needs_review"),
        ),
        MemberId("ponta"),
      )
      found <- fixture.matchDrafts.find(draftId)
    yield
      val updated = assertRight(result)
      assertEquals(updated.status, MatchDraftStatus.NeedsReview)
      assertEquals(updated.heldEventId, Some(heldEventId))
      assertEquals(updated.matchNoInEvent, Some(2))
      assertEquals(updated.layoutFamily, Some("world"))
      assertEquals(updated.updatedAt, updatedAt)
      assertEquals(found.map(_.status), Some(MatchDraftStatus.NeedsReview))
      assertEquals(found.map(_.updatedAt), Some(updatedAt))

  test("rejects updates from a non-owner before changing the draft"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(editingDraft(draftId, MatchDraftStatus.DraftReady))
      result <- fixture.usecase
        .run(draftId, blankCommand.copy(status = Some("needs_review")), MemberId("otaka"))
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(result, "FORBIDDEN", "cannot update")
      assertEquals(found.map(_.status), Some(MatchDraftStatus.DraftReady))
      assertEquals(found.map(_.updatedAt), Some(createdAt))

  test("rejects terminal drafts even when the requester owns them"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(confirmedDraft(draftId))
      result <- fixture.usecase
        .run(draftId, blankCommand.copy(matchNoInEvent = Some(2)), MemberId("ponta"))
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(result, "CONFLICT", "cannot be edited")
      assertEquals(found.map(_.status), Some(MatchDraftStatus.Confirmed))
      assertEquals(found.flatMap(_.confirmedMatchId), Some(MatchId("match-confirmed-1")))

  test("rejects unknown and terminal status values from the update endpoint"):
    for
      fixture <- Fixture.create
      _ <- fixture.seedPrereqs()
      _ <- fixture.matchDrafts.create(editingDraft(draftId, MatchDraftStatus.DraftReady))
      unknown <- fixture.usecase
        .run(draftId, blankCommand.copy(status = Some("not_a_status")), MemberId("ponta"))
      terminal <- fixture.usecase
        .run(draftId, blankCommand.copy(status = Some("confirmed")), MemberId("ponta"))
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(unknown, "VALIDATION_FAILED", "unknown match draft status")
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
        MemberId("ponta"),
      )
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(result, "VALIDATION_FAILED", "mapMasterId")
      assertEquals(found.map(_.gameTitleId), Some(None))

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

  private def confirmedDraft(id: MatchDraftId): MatchDraft =
    draft(id, MatchDraftStatus.Confirmed, confirmedMatchId = Some(MatchId("match-confirmed-1")))

  private def draft(
      id: MatchDraftId,
      status: MatchDraftStatus,
      confirmedMatchId: Option[MatchId],
  ): MatchDraft = MatchDraft.fromInputs(
    id = id,
    createdByMemberId = MemberId("ponta"),
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

  private def assertRight(result: Either[AppError, MatchDraft]): MatchDraft = result match
    case Right(value) => value
    case Left(error) => fail(s"expected success, got: $error")

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
