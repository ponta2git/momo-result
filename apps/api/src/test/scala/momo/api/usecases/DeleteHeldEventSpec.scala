package momo.api.usecases

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.{InMemoryHeldEventsRepository, InMemoryMatchDraftsRepository, InMemoryMatchesRepository}
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError

final class DeleteHeldEventSpec extends CatsEffectSuite:
  private val now = Instant.parse("2026-05-10T10:00:00Z")
  private val heldEventId = HeldEventId("held-delete-usecase")

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
    yield (events, matches, drafts, DeleteHeldEvent[IO](events, matches, drafts))

  private def sampleMatch: MatchRecord = MatchRecord(
    id = MatchId("match-delete-usecase"),
    heldEventId = heldEventId,
    matchNoInEvent = 1,
    gameTitleId = GameTitleId("title_world"),
    layoutFamily = "world",
    seasonMasterId = SeasonMasterId("season_2026"),
    ownerMemberId = MemberId("member_ponta"),
    mapMasterId = MapMasterId("map_east"),
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      PlayerResult(MemberId("member_ponta"), 1, 1, 100, 10, IncidentCounts(0, 0, 0, 0, 0, 0)),
      PlayerResult(MemberId("member_akane_mami"), 2, 2, 90, 9, IncidentCounts(0, 0, 0, 0, 0, 0)),
      PlayerResult(MemberId("member_otaka"), 3, 3, 80, 8, IncidentCounts(0, 0, 0, 0, 0, 0)),
      PlayerResult(MemberId("member_eu"), 4, 4, 70, 7, IncidentCounts(0, 0, 0, 0, 0, 0)),
    ),
    createdByAccountId = AccountId("account_ponta"),
    createdByMemberId = Some(MemberId("member_ponta")),
    createdAt = now,
  )

  private def sampleDraft: MatchDraft = MatchDraft.Editing(
    common = MatchDraftCommon(
      id = MatchDraftId("draft-delete-usecase"),
      createdByMemberId = MemberId("member_ponta"),
      heldEventId = Some(heldEventId),
      matchNoInEvent = Some(1),
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
  )

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
      assert(result.exists(_ == ()) == false)
      result match
        case Left(_: AppError.Conflict) => ()
        case other => fail(s"expected Conflict, got $other")
      assertEquals(found, Some(HeldEvent(heldEventId, now)))

  test("rejects held events with match drafts"):
    for
      (events, _, drafts, usecase) <- fixture
      _ <- events.create(HeldEvent(heldEventId, now))
      _ <- drafts.create(sampleDraft)
      result <- usecase.run(heldEventId)
      found <- events.find(heldEventId)
    yield
      result match
        case Left(_: AppError.Conflict) => ()
        case other => fail(s"expected Conflict, got $other")
      assertEquals(found, Some(HeldEvent(heldEventId, now)))
