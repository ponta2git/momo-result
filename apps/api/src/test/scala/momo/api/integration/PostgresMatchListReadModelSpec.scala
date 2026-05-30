package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.MatchListReadModel
import momo.api.repositories.postgres.*

final class PostgresMatchListReadModelSpec extends IntegrationSuite:

  private val gameTitleId = GameTitleId.unsafeFromString("title_world")
  private val mapMasterId = MapMasterId.unsafeFromString("map_east")
  private val seasonMasterId = SeasonMasterId.unsafeFromString("season_2024_spring")
  private val heldEventId = HeldEventId.unsafeFromString("held_2026_04_30")
  private val baseTime = Instant.parse("2026-04-30T00:00:00Z")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def heldEvents = new PostgresHeldEventsRepository[IO](transactor)
  private def matches = new PostgresMatchesRepository[IO](transactor)
  private def drafts = new PostgresMatchDraftsRepository[IO](transactor)
  private def matchList = new PostgresMatchListReadModel[IO](transactor)

  private def seedPrereqs: IO[Unit] =
    for
      _ <- gameTitles.create(GameTitle(gameTitleId, "桃太郎電鉄ワールド", "world", 1, baseTime))
      _ <- mapMasters.create(MapMaster(mapMasterId, gameTitleId, "東日本編", 1, baseTime))
      _ <- seasonMasters
        .create(SeasonMaster(seasonMasterId, gameTitleId, "2024-spring", 1, baseTime))
      _ <- heldEvents.create(HeldEvent(heldEventId, baseTime))
    yield ()

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult
    .unsafeFromInts(
      memberId = MemberId.unsafeFromString(memberId),
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = 10_000 - (rank * 1_000),
      revenueManYen = 1_000 - (rank * 100),
      incidents = IncidentCounts.unsafeFromInts(
        destination = 0,
        plusStation = 0,
        minusStation = 0,
        cardStation = 0,
        cardShop = 0,
        suriNoGinji = 0,
      ),
    )

  private def sampleMatch(id: String, matchNo: Int, playedAt: Instant): MatchRecord = MatchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNo),
    gameTitleId = gameTitleId,
    layoutFamily = "world",
    seasonMasterId = seasonMasterId,
    ownerMemberId = MemberId.unsafeFromString("member_ponta"),
    mapMasterId = mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      player("member_ponta", 1, 1),
      player("member_akane_mami", 2, 2),
      player("member_otaka", 3, 3),
      player("member_eu", 4, 4),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    createdAt = playedAt,
  )

  private def sampleDraft(
      id: String,
      status: MatchDraftStatus,
      updatedAt: Instant,
      playedAt: Option[Instant] = None, // scalafix:ok DisableSyntax.defaultArgs
  ): MatchDraft = MatchDraft.fromInputs(
    id = MatchDraftId.unsafeFromString(id),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    status = status,
    heldEventId = Some(heldEventId),
    matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(2)),
    gameTitleId = Some(gameTitleId),
    layoutFamily = Some("world"),
    seasonMasterId = Some(seasonMasterId),
    ownerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    mapMasterId = Some(mapMasterId),
    playedAt = playedAt,
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = None,
    createdAt = updatedAt.minusSeconds(60),
    updatedAt = updatedAt,
  ).getOrElse(fail("invalid draft fixture"))

  test("default list returns confirmed matches and active drafts without union SQL errors"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_older", 1, Instant.parse("2026-04-30T01:00:00Z")))
      _ <- drafts.create(sampleDraft(
        "draft_ready",
        MatchDraftStatus.DraftReady,
        Instant.parse("2026-04-30T02:00:00Z"),
      ))
      items <- matchList.list(MatchListReadModel.Filter())
    yield
      assertEquals(items.items.map(_.id), List("draft_ready", "match_older"))
      assertEquals(
        items.items.map(_.kind),
        List(MatchListItemKind.MatchDraft, MatchListItemKind.Match),
      )
      val confirmed = items.items.find(_.id == "match_older").getOrElse(fail("match row missing"))
      assertEquals(confirmed.ranks.map(_.playOrder.value), List(1, 2, 3, 4))
      assertEquals(confirmed.ranks.map(_.rank.value), List(1, 2, 3, 4))

  test("filters confirmed matches and active drafts by kind and status"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_confirmed", 1, Instant.parse("2026-04-30T01:00:00Z")))
      _ <- drafts.create(sampleDraft(
        "draft_ready",
        MatchDraftStatus.DraftReady,
        Instant.parse("2026-04-30T02:00:00Z"),
      ))
      _ <- drafts.create(sampleDraft(
        "draft_cancelled",
        MatchDraftStatus.Cancelled,
        Instant.parse("2026-04-30T03:00:00Z"),
      ))
      confirmed <- matchList.list(
        MatchListReadModel
          .Filter(kind = MatchListKindFilter.Match, status = MatchListStatusFilter.Confirmed)
      )
      draftsOnly <- matchList.list(MatchListReadModel.Filter(kind = MatchListKindFilter.MatchDraft))
    yield
      assertEquals(confirmed.items.map(_.id), List("match_confirmed"))
      assertEquals(draftsOnly.items.map(_.id), List("draft_ready"))

  test("applies status-priority ordering before pagination"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_middle", 1, Instant.parse("2026-04-30T02:00:00Z")))
      _ <- drafts.create(sampleDraft(
        "draft_latest",
        MatchDraftStatus.DraftReady,
        Instant.parse("2026-04-30T03:00:00Z"),
      ))
      _ <- drafts.create(sampleDraft(
        "draft_old_played",
        MatchDraftStatus.NeedsReview,
        Instant.parse("2026-04-30T04:00:00Z"),
        playedAt = Some(Instant.parse("2026-04-30T01:00:00Z")),
      ))
      items <- matchList.list(MatchListReadModel.Filter(page = PageRequest(page = 1, pageSize = 2)))
    yield
      assertEquals(items.items.map(_.id), List("draft_old_played", "draft_latest"))
      assertEquals(items.totalItems, 3)
      assertEquals(items.totalPages, 2)

  test("summarizes active draft work independently of pagination"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_confirmed", 1, Instant.parse("2026-04-30T01:00:00Z")))
      _ <- drafts.create(sampleDraft(
        "draft_ready",
        MatchDraftStatus.DraftReady,
        Instant.parse("2026-04-30T02:00:00Z"),
      ))
      _ <- drafts.create(sampleDraft(
        "draft_needs_review",
        MatchDraftStatus.NeedsReview,
        Instant.parse("2026-04-30T03:00:00Z"),
      ))
      summary <- matchList.summarize(MatchListReadModel.SummaryFilter())
    yield
      assertEquals(summary.incompleteCount, 2)
      assertEquals(summary.ocrRunningCount, 0)
      assertEquals(summary.preConfirmCount, 2)
      assertEquals(summary.needsReviewCount, 1)

end PostgresMatchListReadModelSpec
