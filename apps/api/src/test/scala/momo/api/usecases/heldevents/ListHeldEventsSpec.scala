package momo.api.usecases.heldevents

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.inmemory.{
  InMemoryGameTitlesRepository,
  InMemoryHeldEventsRepository,
  InMemoryMatchDraftsRepository,
  InMemoryMatchesRepository,
  InMemorySeasonMastersRepository
}
import momo.api.domain.ids.*
import momo.api.domain.{
  GameTitle,
  HeldEvent,
  MatchDraft,
  MatchDraftCommon,
  MatchDraftStatus,
  MatchNoInEvent,
  SeasonMaster
}
import momo.api.usecases.testing.MatchFixtures

final class ListHeldEventsSpec extends CatsEffectSuite:
  private val heldEventId = HeldEventId.unsafeFromString("held-list-stats")
  private val heldAt = Instant.parse("2026-08-04T10:00:00Z")

  test("combines confirmed and active-draft maxima for the next match number"):
    for
      events <- InMemoryHeldEventsRepository.create[IO]
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      titles <- InMemoryGameTitlesRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      _ <- titles.createWithNextDisplayOrder(GameTitle(
        GameTitleId.unsafeFromString("title-world"),
        "桃鉄ワールド",
        "world",
        0,
        heldAt
      ))
      _ <- seasons.createWithNextDisplayOrder(SeasonMaster(
        SeasonMasterId.unsafeFromString("season-spring"),
        GameTitleId.unsafeFromString("title-world"),
        "春",
        0,
        heldAt
      ))
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
      _ <- drafts.create(activeDraft(
        5,
        Some(GameTitleId.unsafeFromString("title-world")),
        Some(SeasonMasterId.unsafeFromString("season-spring"))
      ))
      _ <- drafts.create(activeDraft(2, Some(GameTitleId.unsafeFromString("title-world")), None))
      _ <- drafts.create(activeDraft(1, None, None))
      result <-
        ListHeldEvents[IO](events, matches, drafts, titles, seasons).run(None, None, None, None)
    yield result match
      case Left(error) => fail(s"unexpected error: $error")
      case Right(page) =>
        assertEquals(page.totalMatchCount, 1)
        assertEquals(page.items.map(_.matchCount), List(1))
        assertEquals(page.items.map(_.draftCount), List(3))
        assertEquals(page.items.map(_.nextMatchNo), List(6))
        assertEquals(
          page.items.flatMap(_.scopes).map(_.gameTitleName),
          List(Some("桃鉄ワールド"), Some("桃鉄ワールド"))
        )
        assertEquals(page.items.flatMap(_.scopes).map(_.seasonName), List(None, Some("春")))

  private def activeDraft(
      matchNo: Int,
      titleId: Option[GameTitleId],
      seasonId: Option[SeasonMasterId],
  ): MatchDraft = MatchDraft.editable(
    common = MatchDraftCommon(
      id = MatchDraftId.unsafeFromString(s"draft-list-stats-$matchNo"),
      createdByAccountId = AccountId.unsafeFromString("account-ponta"),
      createdByMemberId = None,
      heldEventId = Some(heldEventId),
      matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(matchNo)),
      gameTitleId = titleId,
      layoutFamily = None,
      seasonMasterId = seasonId,
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
