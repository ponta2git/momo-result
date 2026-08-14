package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{
  MatchDraft,
  MatchDraftStatus,
  MatchListItemKind,
  MatchListKindFilter,
  MatchListSort,
  MatchListStatusFilter
}
import momo.api.repositories.MatchListReadModel
import momo.api.usecases.testing.MatchFixtures

final class InMemoryMatchListReadModelSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-14T12:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("event-read-model")
  private val titleId = GameTitleId.unsafeFromString("title-read-model")
  private val seasonId = SeasonMasterId.unsafeFromString("season-read-model")
  private val mapId = MapMasterId.unsafeFromString("map-read-model")

  test("status filters for all kinds do not include confirmed matches in incomplete buckets"):
    for
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      _ <- matches.create(MatchFixtures.matchRecord(
        id = MatchId.unsafeFromString("match-read-model"),
        heldEventId = heldEventId,
        matchNoInEvent = 1,
        titleId = titleId,
        seasonId = seasonId,
        mapId = mapId,
        playedAt = now,
        createdAt = now,
        memberValues = MatchFixtures.DbMemberValues,
        totalAssetsDraftId = None,
        revenueDraftId = None,
        incidentLogDraftId = None,
      ))
      _ <- drafts.create(draft(MatchDraftId.unsafeFromString("draft-read-model")))
      model = InMemoryMatchListReadModel[IO](matches, drafts)
      ocrRunning <- model.list(
        MatchListReadModel
          .Filter(kind = MatchListKindFilter.All, status = MatchListStatusFilter.OcrRunning)
      )
      confirmed <- model.list(
        MatchListReadModel
          .Filter(kind = MatchListKindFilter.All, status = MatchListStatusFilter.Confirmed)
      )
    yield
      assertEquals(ocrRunning.items.map(_.kind), List(MatchListItemKind.MatchDraft))
      assertEquals(confirmed.items.map(_.kind), List(MatchListItemKind.Match))

  test("cursor ordering uses the same sub-millisecond precision as its boundary"):
    val older = now.plusNanos(100_100)
    val newer = now.plusNanos(900_900)
    for
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      _ <- drafts.create(draftAt(MatchDraftId.unsafeFromString("draft-a-older"), older))
      _ <- drafts.create(draftAt(MatchDraftId.unsafeFromString("draft-z-newer"), newer))
      model = InMemoryMatchListReadModel[IO](matches, drafts)
      first <- model.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 1),
      ))
      second <- model.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(
          pageSize = 1,
          cursor = first.nextCursor,
        ),
      ))
    yield
      assertEquals(first.items.map(_.id), List("draft-z-newer"))
      assertEquals(second.items.map(_.id), List("draft-a-older"))

  private def draft(id: MatchDraftId): MatchDraft = draftAt(id, now)

  private def draftAt(id: MatchDraftId, updatedAt: Instant): MatchDraft = MatchDraft.fromInputs(
    id = id,
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    status = MatchDraftStatus.OcrRunning,
    heldEventId = Some(heldEventId),
    matchNoInEvent = None,
    gameTitleId = Some(titleId),
    layoutFamily = Some("world"),
    seasonMasterId = Some(seasonId),
    ownerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    mapMasterId = Some(mapId),
    playedAt = Some(now),
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = None,
    createdAt = now,
    updatedAt = updatedAt,
  ).getOrElse(fail("test fixture draft should be valid"))
