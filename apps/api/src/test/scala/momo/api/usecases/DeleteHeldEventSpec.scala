package momo.api.usecases

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.{
  InMemoryHeldEventDeletionRepository,
  InMemoryHeldEventsRepository,
  InMemoryMatchDraftsRepository,
  InMemoryMatchesRepository
}
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError

final class DeleteHeldEventSpec extends CatsEffectSuite:
  private val now = Instant.parse("2026-05-10T10:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held-delete-usecase")

  private def fixture: IO[
    (
        InMemoryHeldEventsRepository[IO],
        InMemoryMatchesRepository[IO],
        InMemoryMatchDraftsRepository[IO],
        DeleteHeldEvent[IO],
    )
  ] =
    for
      events <- InMemoryHeldEventsRepository.create[IO]
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      deletions = InMemoryHeldEventDeletionRepository[IO](events, matches, drafts)
    yield (events, matches, drafts, DeleteHeldEvent[IO](deletions))

  private def sampleMatch: MatchRecord = MatchRecord(
    id = MatchId.unsafeFromString("match-delete-usecase"),
    heldEventId = heldEventId,
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(1),
    gameTitleId = GameTitleId.unsafeFromString("title_world"),
    layoutFamily = "world",
    seasonMasterId = SeasonMasterId.unsafeFromString("season_2026"),
    ownerMemberId = MemberId.unsafeFromString("member_ponta"),
    mapMasterId = MapMasterId.unsafeFromString("map_east"),
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      PlayerResult.unsafeFromInts(
        MemberId.unsafeFromString("member_ponta"),
        1,
        1,
        100,
        10,
        IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0),
      ),
      PlayerResult.unsafeFromInts(
        MemberId.unsafeFromString("member_akane_mami"),
        2,
        2,
        90,
        9,
        IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0),
      ),
      PlayerResult.unsafeFromInts(
        MemberId.unsafeFromString("member_otaka"),
        3,
        3,
        80,
        8,
        IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0),
      ),
      PlayerResult.unsafeFromInts(
        MemberId.unsafeFromString("member_eu"),
        4,
        4,
        70,
        7,
        IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0),
      ),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    createdAt = now,
  )

  private def sampleDraft: MatchDraft = MatchDraft.editable(
    common = MatchDraftCommon(
      id = MatchDraftId.unsafeFromString("draft-delete-usecase"),
      createdByAccountId = AccountId.unsafeFromString("account_ponta"),
      createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
      heldEventId = Some(heldEventId),
      matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(1)),
      gameTitleId = None,
      layoutFamily = None,
      seasonMasterId = None,
      ownerMemberId = None,
      mapMasterId = None,
      playedAt = Some(now),
      totalAssetsImageId = None,
      revenueImageId = None,
      incidentLogImageId = None,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
      sourceImagesRetainedUntil = None,
      sourceImagesDeletedAt = None,
      createdAt = now,
      updatedAt = now,
    ),
    status = MatchDraftStatus.NeedsReview,
  ).getOrElse(fail("invalid draft fixture"))

  test("deletes an unreferenced held event"):
    for
      (events, _, _, usecase) <- fixture
      _ <- events.create(HeldEvent(heldEventId, now))
      result <- usecase.run(heldEventId)
      found <- events.find(heldEventId)
    yield
      assertEquals(result, Right(()))
      assertEquals(found, None)

  test("returns not found for missing held events"):
    fixture.flatMap { case (_, _, _, usecase) =>
      usecase.run(heldEventId).map(result =>
        assertEquals(result, Left(AppError.NotFound("held event", heldEventId.value)))
      )
    }

  test("rejects held events with confirmed matches"):
    for
      (events, matches, _, usecase) <- fixture
      _ <- events.create(HeldEvent(heldEventId, now))
      _ <- matches.create(sampleMatch)
      result <- usecase.run(heldEventId)
      found <- events.find(heldEventId)
    yield
      assertEquals(result, Left(AppError.Conflict("held event has confirmed matches.")))
      assertEquals(found, Some(HeldEvent(heldEventId, now)))

  test("rejects held events with match drafts"):
    for
      (events, _, drafts, usecase) <- fixture
      _ <- events.create(HeldEvent(heldEventId, now))
      _ <- drafts.create(sampleDraft)
      result <- usecase.run(heldEventId)
      found <- events.find(heldEventId)
    yield
      assertEquals(result, Left(AppError.Conflict("held event has match drafts.")))
      assertEquals(found, Some(HeldEvent(heldEventId, now)))
