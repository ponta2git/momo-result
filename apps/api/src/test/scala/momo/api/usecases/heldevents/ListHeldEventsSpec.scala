package momo.api.usecases.heldevents

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.inmemory.{
  InMemoryHeldEventsRepository,
  InMemoryMatchDraftsRepository,
  InMemoryMatchesRepository
}
import momo.api.domain.ids.*
import momo.api.domain.{HeldEvent, MatchDraft, MatchDraftCommon, MatchDraftStatus, MatchNoInEvent}
import momo.api.usecases.testing.MatchFixtures

final class ListHeldEventsSpec extends CatsEffectSuite:
  private val heldEventId = HeldEventId.unsafeFromString("held-list-stats")
  private val heldAt = Instant.parse("2026-08-04T10:00:00Z")

  test("combines confirmed and active-draft maxima for the next match number"):
    for
      events <- InMemoryHeldEventsRepository.create[IO]
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      _ <- events.create(HeldEvent(heldEventId, heldAt))
      _ <- matches.create(MatchFixtures.matchRecord(
        id = MatchId.unsafeFromString("match-list-stats"),
        heldEventId = heldEventId,
        matchNoInEvent = 3,
        titleId = GameTitleId.unsafeFromString("title-world"),
        seasonId = SeasonMasterId.unsafeFromString("season-spring"),
        mapId = MapMasterId.unsafeFromString("map-east"),
        playedAt = heldAt,
        createdAt = heldAt,
        memberValues = MatchFixtures.DbMemberValues,
        totalAssetsDraftId = None,
        revenueDraftId = None,
        incidentLogDraftId = None,
      ))
      _ <- drafts.create(activeDraft(5))
      result <- ListHeldEvents[IO](events, matches, drafts).run(None, None, None, None)
    yield result match
      case Left(error) => fail(s"unexpected error: $error")
      case Right(page) =>
        assertEquals(page.totalMatchCount, 1)
        assertEquals(page.items.map(_.matchCount), List(1))
        assertEquals(page.items.map(_.draftCount), List(1))
        assertEquals(page.items.map(_.nextMatchNo), List(6))

  private def activeDraft(matchNo: Int): MatchDraft = MatchDraft.editable(
    common = MatchDraftCommon(
      id = MatchDraftId.unsafeFromString("draft-list-stats"),
      createdByAccountId = AccountId.unsafeFromString("account-ponta"),
      createdByMemberId = None,
      heldEventId = Some(heldEventId),
      matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(matchNo)),
      gameTitleId = None,
      layoutFamily = None,
      seasonMasterId = None,
      ownerMemberId = None,
      mapMasterId = None,
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
    status = MatchDraftStatus.DraftReady,
  ).getOrElse(fail("invalid draft fixture"))
