package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.*
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.domain.matchlist.MatchListProjection
import momo.api.repositories.MatchListReadModel

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
  private def confirmations = new PostgresMatchConfirmationRepository[IO](transactor)
  private def drafts = new PostgresMatchDraftsRepository[IO](transactor)
  private def matchList = new PostgresMatchListReadModel[IO](transactor)

  private def createMatch(record: MatchRecord): IO[Unit] = confirmations
    .confirm(record, None, record.createdAt).map(_ => ())

  private def seedPrereqs: IO[Unit] =
    for
      _ <- gameTitles.createWithNextDisplayOrder(
        GameTitle(gameTitleId, "桃太郎電鉄ワールド", "world", 1, baseTime)
      )
      _ <- mapMasters
        .createWithNextDisplayOrder(MapMaster(mapMasterId, gameTitleId, "東日本編", 1, baseTime))
      _ <- seasonMasters
        .createWithNextDisplayOrder(
          SeasonMaster(seasonMasterId, gameTitleId, "2024-spring", 1, baseTime)
        )
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
      _ <- createMatch(sampleMatch("match_older", 1, Instant.parse("2026-04-30T01:00:00Z")))
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
      _ <- createMatch(sampleMatch(
        "match_confirmed",
        1,
        Instant.parse("2026-04-30T01:00:00Z"),
      ))
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

  test("uses persisted draft status even when terminal OCR rows are intentionally inconsistent"):
    val now = Instant.parse("2026-04-30T05:00:00Z")
    for
      _ <- sql"""
        INSERT INTO ocr_drafts (
          id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
          created_at, updated_at
        ) VALUES (
          'draft-persisted-status-slot', 'job-persisted-status-slot', 'total_assets',
          '{}', '[]', '{}', $now, $now
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
          created_at, updated_at
        ) VALUES (
          'match-draft-persisted-status', 'account_ponta', 'member_ponta', 'ocr_running',
          'draft-persisted-status-slot', $now, $now
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO ocr_jobs (
          id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
          created_at, updated_at
        ) VALUES (
          'job-persisted-status-slot', 'draft-persisted-status-slot',
          'image-persisted-status-slot', '/tmp/persisted-status.png', 'total_assets', 'failed', 1,
          $now, $now
        )
      """.update.run.transact(transactor)
      page <- matchList.list(MatchListReadModel.Filter(
        status = MatchListStatusFilter.OcrRunning,
        kind = MatchListKindFilter.MatchDraft,
      ))
    yield
      assertEquals(page.items.map(_.id), List("match-draft-persisted-status"))
      assertEquals(page.items.map(_.status), List("ocr_running"))

  test("applies status-priority ordering before pagination"):
    for
      _ <- seedPrereqs
      _ <- createMatch(sampleMatch("match_middle", 1, Instant.parse("2026-04-30T02:00:00Z")))
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
      items <- matchList.list(MatchListReadModel.Filter(
        page = MatchListReadModel.CursorPageRequest(pageSize = 2)
      ))
    yield
      assertEquals(items.items.map(_.id), List("draft_old_played", "draft_latest"))
      assertEquals(items.totalItems, 3)
      assertEquals(items.totalPages, 2)

  test("pins count, page rows, and rank decoration to one repeatable-read snapshot"):
    for
      _ <- seedPrereqs
      _ <- createMatch(sampleMatch(
        "match-snapshot",
        1,
        Instant.parse("2026-04-30T02:00:00Z"),
      ))
      result <- (for
        page <- PostgresMatchList.alg.list(MatchListReadModel.Filter(
          kind = MatchListKindFilter.Match,
          page = MatchListReadModel.CursorPageRequest(pageSize = 1),
        ))
        isolation <- sql"SHOW transaction_isolation".query[String].unique
      yield (page, isolation)).transact(transactor)
    yield
      assertEquals(result._1.totalItems, 1)
      assertEquals(result._1.items.map(_.id), List("match-snapshot"))
      assertEquals(result._2, "repeatable read")

  test("keeps the initial total snapshot while navigating forward and back with cursors"):
    for
      _ <- seedPrereqs
      _ <- createMatch(sampleMatch("match_middle", 1, Instant.parse("2026-04-30T02:00:00Z")))
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
      firstPage <- matchList.list(MatchListReadModel.Filter(
        page = MatchListReadModel.CursorPageRequest(pageSize = 2)
      ))
      _ <- createMatch(sampleMatch(
        "match-after-snapshot",
        3,
        Instant.parse("2026-04-30T00:30:00Z"),
      ))
      secondCursor = firstPage.nextCursor.getOrElse(fail("next cursor missing"))
      secondPage <- matchList.list(MatchListReadModel.Filter(
        page = MatchListReadModel.CursorPageRequest(pageSize = 2, cursor = Some(secondCursor))
      ))
      previousCursor = secondPage.previousCursor.getOrElse(fail("previous cursor missing"))
      firstAgain <- matchList.list(MatchListReadModel.Filter(
        page = MatchListReadModel.CursorPageRequest(pageSize = 2, cursor = Some(previousCursor))
      ))
    yield
      assertEquals(secondPage.items.map(_.id), List("match_middle"))
      assertEquals(secondPage.totalItems, 3)
      assertEquals(secondPage.totalPages, 2)
      assertEquals(secondPage.page, 2)
      assertEquals(firstAgain.items.map(_.id), firstPage.items.map(_.id))
      assertEquals(firstAgain.totalItems, 3)
      assertEquals(firstAgain.page, 1)

  test("jumps to and navigates around a 503-row tie-heavy last page without an offset"):
    val timestamp = Instant.parse("2026-04-30T06:00:00Z")
    for
      inserted <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, created_at, updated_at
        )
        SELECT
          'deep-draft-' || lpad(series::text, 4, '0'),
          'account_ponta',
          'member_ponta',
          'draft_ready',
          $timestamp,
          $timestamp
        FROM generate_series(1, 503) AS series
      """.update.run.transact(transactor)
      first <- matchList.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 25),
      ))
      lastToken = first.lastCursor.getOrElse(fail("last cursor missing"))
      last <- matchList.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 25, cursor = Some(lastToken)),
      ))
      previousToken = last.previousCursor.getOrElse(fail("previous cursor missing"))
      previous <- matchList.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 25, cursor = Some(previousToken)),
      ))
      nextToken = previous.nextCursor.getOrElse(fail("next cursor missing"))
      lastAgain <- matchList.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 25, cursor = Some(nextToken)),
      ))
    yield
      assertEquals(inserted, 503)
      assertEquals(first.totalItems, 503)
      assertEquals(first.page, 1)
      assertEquals(first.items.map(_.id).take(2), List("deep-draft-0001", "deep-draft-0002"))
      assertEquals(last.page, 21)
      assertEquals(
        last.items.map(_.id),
        List("deep-draft-0501", "deep-draft-0502", "deep-draft-0503"),
      )
      assertEquals(previous.page, 20)
      assertEquals(previous.items.size, 25)
      assertEquals(lastAgain.items.map(_.id), last.items.map(_.id))

  test("preserves every sort's ordering and stable tie-breakers across cursor boundaries"):
    val earliest = Instant.parse("2026-04-30T08:00:00Z")
    val middle = earliest.plusSeconds(60)
    val latest = middle.plusSeconds(60)
    val a = sampleDraft("sort-a", MatchDraftStatus.NeedsReview, earliest).withCommon(_.copy(
      heldEventId = None,
      matchNoInEvent = None,
      playedAt = Some(latest),
    ))
    val b = sampleDraft("sort-b", MatchDraftStatus.DraftReady, latest).withCommon(_.copy(
      heldEventId = None,
      matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(3)),
      playedAt = Some(earliest),
    ))
    val c = sampleDraft("sort-c", MatchDraftStatus.OcrFailed, middle).withCommon(_.copy(
      heldEventId = None,
      matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(1)),
      playedAt = Some(middle),
    ))

    def collect(sort: MatchListSort, cursor: Option[MatchListReadModel.Cursor]): IO[List[String]] =
      matchList.list(MatchListReadModel.Filter(
        kind = MatchListKindFilter.MatchDraft,
        sort = sort,
        page = MatchListReadModel.CursorPageRequest(pageSize = 1, cursor = cursor),
      )).flatMap(page =>
        page.nextCursor match
          case None => IO.pure(page.items.map(_.id))
          case Some(next) => collect(sort, Some(next)).map(page.items.map(_.id) ++ _)
      )

    for
      _ <- seedPrereqs
      _ <- drafts.create(a)
      _ <- drafts.create(b)
      _ <- drafts.create(c)
      statusPriority <- collect(MatchListSort.StatusPriority, None)
      updatedDesc <- collect(MatchListSort.UpdatedDesc, None)
      heldDesc <- collect(MatchListSort.HeldDesc, None)
      heldAsc <- collect(MatchListSort.HeldAsc, None)
      matchNoAsc <- collect(MatchListSort.MatchNoAsc, None)
    yield
      assertEquals(statusPriority, List("sort-a", "sort-b", "sort-c"))
      assertEquals(updatedDesc, List("sort-b", "sort-c", "sort-a"))
      assertEquals(heldDesc, List("sort-a", "sort-c", "sort-b"))
      assertEquals(heldAsc, List("sort-b", "sort-c", "sort-a"))
      assertEquals(matchNoAsc, List("sort-c", "sort-b", "sort-a"))

  test("reapplies filters when an unsigned cursor position is tampered"):
    val firstTime = Instant.parse("2026-04-30T07:00:00Z")
    val secondTime = firstTime.minusSeconds(1)
    val outsideTime = firstTime.plusSeconds(3600)
    for
      _ <- seedPrereqs
      _ <- drafts.create(sampleDraft(
        "inside-filter-first",
        MatchDraftStatus.NeedsReview,
        firstTime,
      ))
      _ <- drafts.create(sampleDraft(
        "inside-filter-second",
        MatchDraftStatus.NeedsReview,
        secondTime,
      ))
      _ <- drafts.create(sampleDraft(
        "outside-filter",
        MatchDraftStatus.DraftReady,
        outsideTime,
      ))
      first <- matchList.list(MatchListReadModel.Filter(
        status = MatchListStatusFilter.NeedsReview,
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 1),
      ))
      issued = first.nextCursor.getOrElse(fail("next cursor missing"))
      tampered = issued.copy(position =
        issued.position.map(_.copy(
          statusPriority = MatchListProjection.displayPriority(MatchDraftStatus.DraftReady),
          updatedAt = outsideTime,
          heldAt = outsideTime,
          kind = "match_draft",
          id = "outside-filter",
        ))
      )
      page <- matchList.list(MatchListReadModel.Filter(
        status = MatchListStatusFilter.NeedsReview,
        kind = MatchListKindFilter.MatchDraft,
        sort = MatchListSort.UpdatedDesc,
        page = MatchListReadModel.CursorPageRequest(pageSize = 1, cursor = Some(tampered)),
      ))
    yield assert(page.items.forall(_.status == MatchDraftStatus.NeedsReview.wire))

  test("summarizes active draft work independently of pagination"):
    for
      _ <- seedPrereqs
      _ <- createMatch(sampleMatch(
        "match_confirmed",
        1,
        Instant.parse("2026-04-30T01:00:00Z"),
      ))
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

  test("lists all active drafts for one held event in match-number order"):
    val fourth = sampleDraft(
      "draft_fourth",
      MatchDraftStatus.NeedsReview,
      Instant.parse("2026-04-30T04:00:00Z"),
    ).withCommon(_.copy(matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(4))))
    for
      _ <- seedPrereqs
      _ <- drafts.create(fourth)
      _ <- drafts.create(sampleDraft(
        "draft_second",
        MatchDraftStatus.DraftReady,
        Instant.parse("2026-04-30T02:00:00Z"),
      ))
      _ <- drafts.create(sampleDraft(
        "draft_cancelled",
        MatchDraftStatus.Cancelled,
        Instant.parse("2026-04-30T01:00:00Z"),
      ))
      items <- matchList.listDraftsByHeldEvent(heldEventId)
    yield
      assertEquals(items.map(_.id), List("draft_second", "draft_fourth"))
      assertEquals(items.map(_.matchNoInEvent.map(_.value)), List(Some(2), Some(4)))

end PostgresMatchListReadModelSpec
