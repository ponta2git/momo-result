package momo.api.usecases.heldevents

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.inmemory.{
  InMemoryHeldEventsRepository,
  InMemoryMatchDraftsRepository,
  InMemoryMatchListReadModel,
  InMemoryMatchesRepository
}
import momo.api.domain.ids.*
import momo.api.domain.{HeldEvent, MatchDraft, MatchDraftCommon, MatchDraftStatus, MatchNoInEvent}
import momo.api.errors.AppError
import momo.api.usecases.testing.MatchFixtures

final class GetHeldEventDetailSpec extends CatsEffectSuite:
  private val heldEventId = HeldEventId.unsafeFromString("held-detail")
  private val heldAt = Instant.parse("2026-08-04T10:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title-world")
  private val seasonId = SeasonMasterId.unsafeFromString("season-spring")
  private val mapId = MapMasterId.unsafeFromString("map-east")

  private def fixture =
    for
      events <- InMemoryHeldEventsRepository.create[IO]
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      matchList = InMemoryMatchListReadModel[IO](matches, drafts)
    yield (events, matches, drafts, GetHeldEventDetail[IO](events, matches, matchList))

  private def matchRecord(id: String, matchNo: Int) = MatchFixtures.matchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = matchNo,
    titleId = titleId,
    seasonId = seasonId,
    mapId = mapId,
    playedAt = heldAt.plusSeconds(matchNo.toLong * 60),
    createdAt = heldAt,
    memberValues = MatchFixtures.DbMemberValues,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
  )

  private def draft(matchNo: Int): MatchDraft = MatchDraft.editable(
    common = MatchDraftCommon(
      id = MatchDraftId.unsafeFromString(s"draft-$matchNo"),
      createdByAccountId = AccountId.unsafeFromString("account-ponta"),
      createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
      heldEventId = Some(heldEventId),
      matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(matchNo)),
      gameTitleId = Some(titleId),
      layoutFamily = Some("world"),
      seasonMasterId = Some(seasonId),
      ownerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
      mapMasterId = Some(mapId),
      playedAt = Some(heldAt),
      totalAssetsImageId = None,
      revenueImageId = None,
      incidentLogImageId = None,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
      sourceImagesRetainedUntil = None,
      sourceImagesDeletedAt = None,
      createdAt = heldAt,
      updatedAt = heldAt,
    ),
    status = MatchDraftStatus.NeedsReview,
  ).getOrElse(fail("invalid draft fixture"))

  test("returns confirmed matches in match-number order and includes active drafts"):
    for
      (events, matches, drafts, usecase) <- fixture
      _ <- events.create(HeldEvent(heldEventId, heldAt))
      _ <- matches.create(matchRecord("match-3", 3))
      _ <- matches.create(matchRecord("match-1", 1))
      _ <- drafts.create(draft(5))
      result <- usecase.run(heldEventId)
    yield result match
      case Left(error) => fail(s"unexpected error: $error")
      case Right(detail) =>
        assertEquals(detail.matches.map(_.matchNoInEvent.value), List(1, 3))
        assertEquals(detail.drafts.map(_.matchNoInEvent.map(_.value)), List(Some(5)))
        assertEquals(detail.drafts.map(_.status), List("needs_review"))
        assertEquals(detail.nextMatchNo, 6)

  test("returns next match number one for an empty event"):
    for
      (events, _, _, usecase) <- fixture
      _ <- events.create(HeldEvent(heldEventId, heldAt))
      result <- usecase.run(heldEventId)
    yield result match
      case Left(error) => fail(s"unexpected error: $error")
      case Right(detail) =>
        assertEquals(detail.matches, Nil)
        assertEquals(detail.drafts, Nil)
        assertEquals(detail.nextMatchNo, 1)

  test("returns not found when the held event does not exist"):
    fixture.flatMap { case (_, _, _, usecase) =>
      usecase.run(heldEventId).map(result =>
        assertEquals(result, Left(AppError.NotFound("held event", heldEventId.value)))
      )
    }
