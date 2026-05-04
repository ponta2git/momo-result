package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.MatchListRepository
import momo.api.repositories.postgres.*

final class PostgresMatchListRepositorySpec extends IntegrationSuite:

  private val gameTitleId = GameTitleId("title_world")
  private val mapMasterId = MapMasterId("map_east")
  private val seasonMasterId = SeasonMasterId("season_2024_spring")
  private val heldEventId = HeldEventId("held_2026_04_30")
  private val baseTime = Instant.parse("2026-04-30T00:00:00Z")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def heldEvents = new PostgresHeldEventsRepository[IO](transactor)
  private def matches = new PostgresMatchesRepository[IO](transactor)
  private def drafts = new PostgresMatchDraftsRepository[IO](transactor)
  private def matchList = new PostgresMatchListRepository[IO](transactor)

  private def seedPrereqs: IO[Unit] =
    for
      _ <- gameTitles.create(GameTitle(gameTitleId, "桃太郎電鉄ワールド", "world", 1, baseTime))
      _ <- mapMasters.create(MapMaster(mapMasterId, gameTitleId, "東日本編", 1, baseTime))
      _ <- seasonMasters
        .create(SeasonMaster(seasonMasterId, gameTitleId, "2024-spring", 1, baseTime))
      _ <- heldEvents.create(HeldEvent(heldEventId, baseTime))
    yield ()

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult(
    memberId = MemberId(memberId),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = 10_000 - (rank * 1_000),
    revenueManYen = 1_000 - (rank * 100),
    incidents = IncidentCounts(
      destination = 0,
      plusStation = 0,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = 0,
    ),
  )

  private def sampleMatch(id: String, matchNo: Int, playedAt: Instant): MatchRecord = MatchRecord(
    id = MatchId(id),
    heldEventId = heldEventId,
    matchNoInEvent = matchNo,
    gameTitleId = gameTitleId,
    layoutFamily = "world",
    seasonMasterId = seasonMasterId,
    ownerMemberId = MemberId("member_ponta"),
    mapMasterId = mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = List(
      player("member_ponta", 1, 1),
      player("member_akane_mami", 2, 2),
      player("member_otaka", 3, 3),
      player("member_eu", 4, 4),
    ),
    createdByMemberId = MemberId("member_ponta"),
    createdAt = playedAt,
  )

  private def sampleDraft(
      id: String,
      status: MatchDraftStatus,
      updatedAt: Instant,
      playedAt: Option[Instant] = None, // scalafix:ok DisableSyntax.defaultArgs
  ): MatchDraft = MatchDraft(
    id = MatchDraftId(id),
    createdByMemberId = MemberId("member_ponta"),
    status = status,
    heldEventId = Some(heldEventId),
    matchNoInEvent = Some(2),
    gameTitleId = Some(gameTitleId),
    layoutFamily = Some("world"),
    seasonMasterId = Some(seasonMasterId),
    ownerMemberId = Some(MemberId("member_ponta")),
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
  )

  test("default list returns confirmed matches and active drafts without union SQL errors"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_older", 1, Instant.parse("2026-04-30T01:00:00Z")))
      _ <- drafts.create(sampleDraft(
        "draft_ready",
        MatchDraftStatus.DraftReady,
        Instant.parse("2026-04-30T02:00:00Z"),
      ))
      items <- matchList.list(MatchListRepository.Filter())
    yield
      assertEquals(items.map(_.id), List("draft_ready", "match_older"))
      assertEquals(items.map(_.kind), List(MatchListItemKind.MatchDraft, MatchListItemKind.Match))
      val confirmed = items.find(_.id == "match_older").getOrElse(fail("match row missing"))
      assertEquals(confirmed.ranks.map(_.playOrder), List(1, 2, 3, 4))
      assertEquals(confirmed.ranks.map(_.rank), List(1, 2, 3, 4))

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
      confirmed <- matchList.list(MatchListRepository.Filter(
        kind = MatchListRepository.KindFilter.Match,
        status = MatchListRepository.StatusFilter.Confirmed,
      ))
      draftsOnly <- matchList
        .list(MatchListRepository.Filter(kind = MatchListRepository.KindFilter.MatchDraft))
    yield
      assertEquals(confirmed.map(_.id), List("match_confirmed"))
      assertEquals(draftsOnly.map(_.id), List("draft_ready"))

  test("orders by playedAt or updatedAt before applying limit"):
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
      items <- matchList.list(MatchListRepository.Filter(limit = Some(2)))
    yield assertEquals(items.map(_.id), List("draft_latest", "match_middle"))

end PostgresMatchListRepositorySpec
