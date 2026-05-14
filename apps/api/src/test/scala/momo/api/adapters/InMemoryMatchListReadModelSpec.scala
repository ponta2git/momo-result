package momo.api.adapters

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchListItemKind}
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
      ocrRunning <- model.list(MatchListReadModel.Filter(
        kind = MatchListReadModel.KindFilter.All,
        status = MatchListReadModel.StatusFilter.OcrRunning,
      ))
      confirmed <- model.list(MatchListReadModel.Filter(
        kind = MatchListReadModel.KindFilter.All,
        status = MatchListReadModel.StatusFilter.Confirmed,
      ))
    yield
      assertEquals(ocrRunning.map(_.kind), List(MatchListItemKind.MatchDraft))
      assertEquals(confirmed.map(_.kind), List(MatchListItemKind.Match))

  private def draft(id: MatchDraftId): MatchDraft = MatchDraft.fromInputs(
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
    updatedAt = now,
  ).getOrElse(fail("test fixture draft should be valid"))
