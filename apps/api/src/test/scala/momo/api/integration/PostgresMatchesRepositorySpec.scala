package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.*
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  MatchConfirmationResult,
  MatchDraftConfirmation,
  MatchExportsRepository
}

final class PostgresMatchesRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-04-30T00:00:00Z")
  private val gameTitleId = GameTitleId.unsafeFromString("title_world")
  private val mapMasterId = MapMasterId.unsafeFromString("map_east")
  private val seasonMasterId = SeasonMasterId.unsafeFromString("season_2024_spring")
  private val heldEventId = HeldEventId.unsafeFromString("held_2026_04_30")
  private val secondGameTitleId = GameTitleId.unsafeFromString("title_world_2")
  private val secondMapMasterId = MapMasterId.unsafeFromString("map_west")
  private val secondSeasonMasterId = SeasonMasterId.unsafeFromString("season_2025_spring")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def heldEvents = new PostgresHeldEventsRepository[IO](transactor)
  private def matches = new PostgresMatchesRepository[IO](transactor)
  private def matchNotes = new PostgresMatchNotesRepository[IO](transactor)
  private def matchExports = new PostgresMatchExportsRepository[IO](transactor)
  private def confirmations = new PostgresMatchConfirmationRepository[IO](transactor)
  private def createMatch(record: MatchRecord): IO[Unit] = confirmations
    .confirm(record, None, record.createdAt)
    .flatMap(_.leftMap(error => new AssertionError(error.toString)).liftTo[IO]).void

  /** Insert a complete prerequisite graph: game/map/season/held_event. */
  private def seedPrereqs: IO[Unit] =
    for
      _ <- gameTitles
        .createWithNextDisplayOrder(GameTitle(gameTitleId, "桃太郎電鉄ワールド", "world", 1, now))
      _ <- mapMasters
        .createWithNextDisplayOrder(MapMaster(mapMasterId, gameTitleId, "東日本編", 1, now))
      _ <- seasonMasters
        .createWithNextDisplayOrder(SeasonMaster(
          seasonMasterId,
          gameTitleId,
          "2024-spring",
          1,
          now
        ))
      _ <- heldEvents.create(HeldEvent(heldEventId, now))
    yield ()

  private def seedSecondTitle: IO[Unit] =
    for
      _ <- gameTitles.createWithNextDisplayOrder(
        GameTitle(secondGameTitleId, "桃太郎電鉄ワールド2", "world", 2, now)
      )
      _ <- mapMasters
        .createWithNextDisplayOrder(MapMaster(secondMapMasterId, secondGameTitleId, "西日本編", 1, now))
      _ <- seasonMasters
        .createWithNextDisplayOrder(
          SeasonMaster(secondSeasonMasterId, secondGameTitleId, "2025-spring", 1, now)
        )
    yield ()

  private def player(
      memberId: String,
      playOrder: Int,
      rank: Int,
      totalAssets: Int,
      revenue: Int,
  ): PlayerResult = playerWithIncidents(
    memberId = memberId,
    playOrder = playOrder,
    rank = rank,
    totalAssets = totalAssets,
    revenue = revenue,
    destination = 0,
    plusStation = 0,
  )

  private def playerWithIncidents(
      memberId: String,
      playOrder: Int,
      rank: Int,
      totalAssets: Int,
      revenue: Int,
      destination: Int,
      plusStation: Int,
  ): PlayerResult = PlayerResult.unsafeFromInts(
    memberId = MemberId.unsafeFromString(memberId),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = totalAssets,
    revenueManYen = revenue,
    incidents = IncidentCounts.unsafeFromInts(
      destination = destination,
      plusStation = plusStation,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = 0,
    ),
  )

  private def sampleMatch(id: String, matchNo: Int): MatchRecord = MatchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNo),
    gameTitleId = gameTitleId,
    layoutFamily = "world",
    seasonMasterId = seasonMasterId,
    ownerMemberId = MemberId.unsafeFromString("member_ponta"),
    mapMasterId = mapMasterId,
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      playerWithIncidents("member_ponta", 1, 1, 12000, 3000, destination = 5, plusStation = 2),
      player("member_akane_mami", 2, 2, 9000, 1500),
      player("member_otaka", 3, 3, 6500, 800),
      player("member_eu", 4, 4, 4000, 200),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    createdAt = now,
  )

  test("create persists matches + 4 players + 24 incident rows atomically"):
    val rec = sampleMatch("match_001", 1)
    for
      _ <- seedPrereqs
      _ <- createMatch(rec)
      found <- matches.find(MatchId.unsafeFromString("match_001"))
    yield
      val got = found.getOrElse(fail("match_001 not found after create"))
      assertEquals(got.id, rec.id)
      assertEquals(got.players.toList.size, 4)
      assertEquals(got.players.byPlayOrder.map(_.playOrder.value), List(1, 2, 3, 4))
      assertEquals(got.players.toList.map(_.rank.value).sorted, List(1, 2, 3, 4))
      val ponta = got.players.toList.find(_.memberId == MemberId.unsafeFromString("member_ponta"))
        .get
      assertEquals(ponta.totalAssetsManYen.value, 12000)
      assertEquals(ponta.incidents.destination.value, 5)
      assertEquals(ponta.incidents.plusStation.value, 2)
      assertEquals(ponta.incidents.suriNoGinji.value, 0)

  test("confirmed-match mutations atomically advance title and match revisions with durable work"):
    val rec = sampleMatch("match_analysis_intent", 1)
    val moved = rec.copy(
      gameTitleId = secondGameTitleId,
      mapMasterId = secondMapMasterId,
      seasonMasterId = secondSeasonMasterId,
    )
    for
      _ <- seedPrereqs
      _ <- seedSecondTitle
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET algorithm_version = 'series-analysis-v3',
            artifact_schema_version = 2,
            validation_contract_id = 'series-analysis-artifact-v2-full-validation-v1'
        WHERE game_title_id IN ($gameTitleId, $secondGameTitleId)
      """.update.run.transact(transactor)
      _ <- createMatch(rec)
      _ <- matches.update(moved, now.plusSeconds(1))
      matchRevision <- sql"SELECT analysis_revision FROM matches WHERE id = ${rec.id}"
        .query[Long].unique.transact(transactor)
      deleted <- matches.delete(rec.id)
      titleRevisions <- sql"""
        SELECT game_title_id, input_revision
        FROM series_analysis_title_states
        WHERE game_title_id IN ($gameTitleId, $secondGameTitleId)
        ORDER BY game_title_id
      """.query[(GameTitleId, Long)].to[List].transact(transactor)
      counts <- sql"""
        SELECT
          (SELECT COUNT(*)::int FROM series_analysis_jobs WHERE status = 'queued'),
          (SELECT COUNT(*)::int FROM series_analysis_job_requests),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox),
          (SELECT COUNT(*)::int FROM matches WHERE id = ${rec.id}),
          (SELECT bool_and(validation_contract_id = 'series-analysis-artifact-v2-full-validation-v1') FROM series_analysis_jobs),
          (SELECT bool_and(validation_contract_id = 'series-analysis-artifact-v2-full-validation-v1') FROM series_analysis_job_requests)
      """.query[(Int, Int, Int, Int, Boolean, Boolean)].unique.transact(transactor)
    yield
      assertEquals(deleted, true)
      assertEquals(matchRevision, 1L)
      assertEquals(titleRevisions.toMap.get(gameTitleId), Some(2L))
      assertEquals(titleRevisions.toMap.get(secondGameTitleId), Some(2L))
      assertEquals(counts, (2, 4, 4, 0, true, true))

  test("listByHeldEvent orders by match_no_in_event"):
    for
      _ <- seedPrereqs
      _ <- createMatch(sampleMatch("match_b", 2))
      _ <- createMatch(sampleMatch("match_a", 1))
      list <- matches.listByHeldEvent(heldEventId)
    yield
      assertEquals(list.map(_.id.value), List("match_a", "match_b"))
      assertEquals(list.map(_.matchNoInEvent.value), List(1, 2))

  test(
    "held-event detail reads ordered results, notes and active drafts in one read-only snapshot"
  ):
    val detail = new PostgresHeldEventDetailReadModel[IO](transactor)
    val absentId = HeldEventId.unsafeFromString("held_absent")
    val otherId = HeldEventId.unsafeFromString("held_other")
    val body = MatchNoteBody.fromRequiredString("開催内の試合メモ\n2行目").toOption.get
    for
      _ <- seedPrereqs
      absent <- detail.find(absentId)
      empty <- detail.find(heldEventId)
      missingSummary <- detail.summary(absentId)
      emptySummary <- detail.summary(heldEventId)
      _ <- heldEvents.create(HeldEvent(otherId, now))
      _ <- createMatch(sampleMatch("detail-second", 2))
      _ <- createMatch(sampleMatch("detail-first", 1))
      _ <- createMatch(sampleMatch("detail-other", 9).copy(heldEventId = otherId))
      _ <- matchNotes.replace(
        MatchId.unsafeFromString("detail-first"),
        MatchNoteVersion.Initial,
        Some(body),
        AccountId.unsafeFromString("account_ponta"),
        now.plusSeconds(1),
      )
      _ <- sql"""
        INSERT INTO match_drafts (
          id, held_event_id, match_no_in_event, status,
          created_by_account_id, created_by_member_id, created_at, updated_at
        ) VALUES
          ('detail-ready', $heldEventId, 4, 'draft_ready', 'account_ponta', 'member_ponta', $now, $now),
          ('detail-review', $heldEventId, 3, 'needs_review', 'account_ponta', 'member_ponta', $now, $now),
          ('detail-unnumbered', $heldEventId, NULL, 'ocr_running', 'account_ponta', 'member_ponta', $now, $now),
          ('detail-cancelled', $heldEventId, 90, 'cancelled', 'account_ponta', 'member_ponta', $now, $now),
          ('detail-confirmed', $heldEventId, 91, 'confirmed', 'account_ponta', 'member_ponta', $now, $now),
          ('detail-outside', $otherId, 92, 'draft_ready', 'account_ponta', 'member_ponta', $now, $now)
      """.update.run.transact(transactor)
      summary <- detail.summary(heldEventId)
      snapshot <- (for
        result <- PostgresHeldEventDetail.find(heldEventId)
        isolation <- sql"SHOW transaction_isolation".query[String].unique
        readOnly <- sql"SHOW transaction_read_only".query[String].unique
      yield (result, isolation, readOnly)).transact(transactor)
    yield
      assertEquals(absent, None)
      assertEquals(missingSummary, None)
      assertEquals(emptySummary, Some(HeldEventSummary(HeldEvent(heldEventId, now), 0, 0, 1)))
      assertEquals(summary, Some(HeldEventSummary(HeldEvent(heldEventId, now), 2, 3, 5)))
      assertEquals(empty.map(_.nextMatchNo), Some(1))
      assertEquals(empty.map(_.matches), Some(Nil))
      assertEquals(empty.map(_.drafts), Some(Nil))
      val result = snapshot._1.getOrElse(fail("held-event detail missing"))
      assertEquals(result.event, HeldEvent(heldEventId, now))
      assertEquals(result.matches.map(_.id.value), List("detail-first", "detail-second"))
      assertEquals(result.matches.map(_.noteBody), List(Some(body.value), None))
      assertEquals(result.matches.head.players.map(_.playOrder.value), List(1, 2, 3, 4))
      assertEquals(
        result.matches.head.players.map(_.totalAssetsManYen.value),
        List(12000, 9000, 6500, 4000)
      )
      assertEquals(
        result.drafts.map(_.id.value),
        List("detail-review", "detail-ready", "detail-unnumbered")
      )
      assertEquals(
        result.drafts.map(_.status),
        List(MatchDraftStatus.NeedsReview, MatchDraftStatus.DraftReady, MatchDraftStatus.OcrRunning)
      )
      assertEquals(
        result.matches.head.labels,
        MatchLabels(Some("桃太郎電鉄ワールド"), Some("2024-spring"), Some("東日本編"))
      )
      assertEquals(result.drafts.head.labels, MatchLabels.empty)
      assertEquals(result.nextMatchNo, 5)
      assertEquals(snapshot._2, "repeatable read")
      assertEquals(snapshot._3, "on")

  test("match display metadata and note attribution belong to the result snapshot"):
    val record = sampleMatch("display-snapshot", 1).copy(playedAt = now.plusSeconds(3600))
    val details = new PostgresMatchDetailReadModel[IO](transactor)
    for
      _ <- seedPrereqs
      _ <- createMatch(record)
      _ <- matchNotes.replace(
        record.id,
        MatchNoteVersion.Initial,
        MatchNoteBody.fromRequiredString("note").toOption,
        AccountId.unsafeFromString("account_ponta"),
        now.plusSeconds(1)
      )
      identity <- details.identity(record.id)
      missing <- details.identity(MatchId.unsafeFromString("missing-identity"))
      snapshot <- (for
        result <- PostgresMatchDetail.find(record.id)
        isolation <- sql"SHOW transaction_isolation".query[String].unique
        readOnly <- sql"SHOW transaction_read_only".query[String].unique
      yield (result, isolation, readOnly)).transact(transactor)
    yield
      val detail = snapshot._1.getOrElse(fail("match detail missing"))
      assertEquals(detail.heldAt, Some(now))
      assertEquals(detail.record.playedAt, now.plusSeconds(3600))
      assertEquals(detail.labels, MatchLabels(Some("桃太郎電鉄ワールド"), Some("2024-spring"), Some("東日本編")))
      assert(detail.noteUpdatedByDisplayName.nonEmpty)
      assertEquals(
        identity,
        Some(MatchIdentity(
          record.id,
          record.matchNoInEvent,
          record.playedAt,
          Some("桃太郎電鉄ワールド"),
          Some("2024-spring")
        ))
      )
      assertEquals(missing, None)
      assertEquals(snapshot._2, "repeatable read")
      assertEquals(snapshot._3, "on")

  test("held-event pages project only their scopes while totals cover all matching events"):
    val latestId = HeldEventId.unsafeFromString("held_latest")
    val emptyId = HeldEventId.unsafeFromString("held_empty")
    val reader = new PostgresHeldEventListReadModel[IO](transactor)
    for
      _ <- seedPrereqs
      _ <- seedSecondTitle
      _ <- heldEvents.create(HeldEvent(latestId, now.plusSeconds(7200)))
      _ <- heldEvents.create(HeldEvent(emptyId, now.plusSeconds(3600)))
      _ <- createMatch(sampleMatch("held-list-first", 1))
      _ <- createMatch(sampleMatch("held-list-third", 3))
      _ <- createMatch(sampleMatch("held-list-other", 1).copy(
        heldEventId = latestId,
        gameTitleId = secondGameTitleId,
        seasonMasterId = secondSeasonMasterId,
        mapMasterId = secondMapMasterId,
      ))
      _ <- sql"""
        INSERT INTO match_drafts (
          id, held_event_id, match_no_in_event, status, game_title_id, season_master_id,
          created_by_account_id, created_at, updated_at
        ) VALUES
          ('held-list-ready', $heldEventId, 7, 'draft_ready', $gameTitleId, $seasonMasterId, 'account_ponta', $now, $now),
          ('held-list-partial', $heldEventId, 5, 'needs_review', $gameTitleId, NULL, 'account_ponta', $now, $now),
          ('held-list-no-scope', $heldEventId, 9, 'draft_ready', NULL, NULL, 'account_ponta', $now, $now),
          ('held-list-no-number', $heldEventId, NULL, 'ocr_running', NULL, NULL, 'account_ponta', $now, $now),
          ('held-list-cancelled', $heldEventId, 99, 'cancelled', $gameTitleId, $seasonMasterId, 'account_ponta', $now, $now),
          ('held-list-confirmed', $heldEventId, 100, 'confirmed', $gameTitleId, $seasonMasterId, 'account_ponta', $now, $now)
      """.update.run.transact(transactor)
      latest <- reader.list(None, PageRequest(1, 1))
      empty <- reader.list(None, PageRequest(2, 1))
      beyond <- reader.list(None, PageRequest(4, 1))
      filtered <- reader.list(Some(" HELD_2026 "), PageRequest(1, 20))
      missing <- reader.list(Some("absent"), PageRequest(1, 20))
      snapshot <- (for
        result <- PostgresHeldEventList.list(None, PageRequest(3, 1))
        isolation <- sql"SHOW transaction_isolation".query[String].unique
        readOnly <- sql"SHOW transaction_read_only".query[String].unique
      yield (result, isolation, readOnly)).transact(transactor)
    yield
      assertEquals(latest.page.totalItems, 3)
      assertEquals(latest.totalMatchCount, 3)
      assertEquals(latest.page.items.map(_.event.id), List(latestId))
      assertEquals(
        latest.page.items.flatMap(_.scopes).map(_.gameTitleName),
        List(Some("桃太郎電鉄ワールド2"))
      )
      assertEquals(
        empty.page.items.map(item => (item.matchCount, item.draftCount, item.nextMatchNo)),
        List((0, 0, 1))
      )
      assertEquals(beyond.page.items, Nil)
      assertEquals(beyond.totalMatchCount, 3)
      assertEquals(filtered.page.totalItems, 1)
      assertEquals(filtered.totalMatchCount, 2)
      assertEquals(missing.page.items, Nil)
      assertEquals(missing.totalMatchCount, 0)
      val current = snapshot._1.page.items.headOption.getOrElse(fail("held event missing"))
      assertEquals(current.event.id, heldEventId)
      assertEquals((current.matchCount, current.draftCount, current.nextMatchNo), (2, 4, 10))
      assertEquals(current.scopes.map(_.gameTitleName), List(Some("桃太郎電鉄ワールド"), Some("桃太郎電鉄ワールド")))
      assertEquals(current.scopes.map(_.seasonName), List(None, Some("2024-spring")))
      assertEquals(snapshot._2, "repeatable read")
      assertEquals(snapshot._3, "on")

  test("held-event detail rejects missing players instead of emitting a partial lineup"):
    val record = sampleMatch("detail-missing-player", 1)
    for
      _ <- seedPrereqs
      _ <- createMatch(record)
      _ <- sql"DELETE FROM match_incidents WHERE match_id = ${record.id}".update.run.transact(
        transactor
      )
      _ <-
        sql"DELETE FROM match_players WHERE match_id = ${record.id} AND play_order = 4".update.run.transact(
          transactor
        )
      result <- new PostgresHeldEventDetailReadModel[IO](transactor).find(heldEventId).attempt
    yield result match
      case Left(_: PostgresDataIntegrityException) => ()
      case other => fail(s"expected data integrity failure, got $other")

  test("note replacement is versioned without advancing analysis state or outbox"):
    val record = sampleMatch("match_note_versioned", 1)
    val accountId = AccountId.unsafeFromString("account_ponta")
    val body = MatchNoteBody.fromRequiredString("終盤のカード交換が決め手").toOption.get
    for
      _ <- seedPrereqs
      _ <- createMatch(record)
      before <- sql"""
        SELECT
          analysis_revision,
          (SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = $gameTitleId),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox)
        FROM matches WHERE id = ${record.id}
      """.query[(Long, Long, Int)].unique.transact(transactor)
      first <- matchNotes.replace(
        record.id,
        MatchNoteVersion.Initial,
        Some(body),
        accountId,
        now.plusSeconds(1),
      )
      stale <- matchNotes.replace(
        record.id,
        MatchNoteVersion.Initial,
        Some(body),
        accountId,
        now.plusSeconds(2),
      )
      noOp <- matchNotes.replace(
        record.id,
        MatchNoteVersion.Initial.next,
        Some(body),
        accountId,
        now.plusSeconds(3),
      )
      deleted <- matchNotes.replace(
        record.id,
        MatchNoteVersion.Initial.next,
        None,
        accountId,
        now.plusSeconds(4),
      )
      found <- matches.find(record.id)
      after <- sql"""
        SELECT
          analysis_revision,
          (SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = $gameTitleId),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox)
        FROM matches WHERE id = ${record.id}
      """.query[(Long, Long, Int)].unique.transact(transactor)
    yield
      first match
        case momo.api.repositories.ReplaceMatchNoteResult.Updated(note) =>
          assertEquals(note.body.map(_.value), Some(body.value))
        case other => fail(s"expected Updated, got $other")
      assertEquals(stale, momo.api.repositories.ReplaceMatchNoteResult.VersionConflict)
      noOp match
        case momo.api.repositories.ReplaceMatchNoteResult.Unchanged(note) =>
          assertEquals(note.version, MatchNoteVersion.Initial.next)
        case other => fail(s"expected Unchanged, got $other")
      deleted match
        case momo.api.repositories.ReplaceMatchNoteResult.Updated(note) =>
          assertEquals(note.body, None)
        case other => fail(s"expected Updated, got $other")
      assertEquals(found.flatMap(_.note.body).map(_.value), None)
      assertEquals(found.map(_.note.version), Some(MatchNoteVersion.Initial.next.next))
      assertEquals(after, before)

  test("export projection ranks full parent history but loads only selected children"):
    val laterSeasonId = SeasonMasterId.unsafeFromString("season_2024_later")
    val records = (1 to 4).toList.map { index =>
      val playedAt = index match
        case 1 => now.plusMillis(1).plusNanos(800000)
        case 2 => now.plusMillis(1).plusNanos(100000)
        case _ => now.plusSeconds(index.toLong)
      sampleMatch(s"match_export_$index", index).copy(
        seasonMasterId = if index <= 2 then seasonMasterId else laterSeasonId,
        playedAt = playedAt,
        createdAt = now.plusSeconds(index.toLong),
      )
    }
    for
      _ <- seedPrereqs
      _ <- seedSecondTitle
      _ <- createMatch(sampleMatch("match_export_other_title", 5).copy(
        gameTitleId = secondGameTitleId,
        mapMasterId = secondMapMasterId,
        seasonMasterId = secondSeasonMasterId,
        playedAt = now.minusSeconds(10),
      ))
      _ <- seasonMasters.createWithNextDisplayOrder(
        SeasonMaster(laterSeasonId, gameTitleId, "2024-later", 2, now)
      )
      _ <- records.traverse_(createMatch)
      _ <- sql"DELETE FROM match_incidents WHERE match_id = ${records.head.id}".update.run
        .transact(transactor)
      _ <- sql"DELETE FROM match_players WHERE match_id = ${records.head.id}".update.run
        .transact(transactor)
      single <- matchExports.project(
        MatchExportsRepository.Selection(
          matchId = Some(records.last.id),
          limit = 2,
        )
      )
      sameMillisecond <- matchExports.project(
        MatchExportsRepository.Selection(matchId = Some(records(1).id), limit = 2)
      )
      other <- matchExports.project(MatchExportsRepository.Selection(
        seasonMasterId = Some(secondSeasonMasterId),
        limit = 2,
      ))
      absent <- matchExports.project(MatchExportsRepository.Selection(
        matchId = Some(MatchId.unsafeFromString("absent-export-match")),
        limit = 2,
      ))
      recent <- matchExports.project(
        MatchExportsRepository.Selection(limit = 2)
      )
      snapshot <- (for
        rows <- PostgresMatchExports.alg.project(MatchExportsRepository.Selection(
          matchId = Some(records.last.id),
          limit = 2
        ))
        isolation <- sql"SHOW transaction_isolation".query[String].unique
        readOnly <- sql"SHOW transaction_read_only".query[String].unique
      yield (rows, isolation, readOnly)).transact(transactor)
    yield
      assertEquals(other.map(row => row.seasonNo -> row.gameTitleMatchNo), List.fill(4)(1 -> 1))
      assertEquals(absent, Nil)
      assertEquals(single.map(_.playedAt).distinct, List(records.last.playedAt))
      assertEquals(single.map(_.seasonNo), List.fill(4)(2))
      assertEquals(single.map(_.gameTitleMatchNo), List.fill(4)(4))
      assertEquals(single.map(_.playOrder), List(1, 2, 3, 4))
      assertEquals(single.map(_.seasonName).distinct, List("2024-later"))
      assertEquals(single.map(_.mapName).distinct, List("東日本編"))
      assertEquals(single.map(_.ownerName).distinct, List("ぽんた"))
      assertEquals(single.head.playerName, "ぽんた")
      assertEquals(single.head.incidents.destination.value, 5)
      assertEquals(sameMillisecond.map(_.seasonNo), List.fill(4)(2))
      assertEquals(sameMillisecond.map(_.gameTitleMatchNo), List.fill(4)(2))
      assertEquals(recent.map(_.playedAt).distinct, records.takeRight(2).map(_.playedAt))
      assertEquals(recent.map(_.seasonNo), List.fill(4)(1) ++ List.fill(4)(2))
      assertEquals(recent.map(_.gameTitleMatchNo), List.fill(4)(3) ++ List.fill(4)(4))
      assertEquals(snapshot._1, single)
      assertEquals(snapshot._2, "repeatable read")
      assertEquals(snapshot._3, "on")

  test("existsMatchNo reflects inserted rows"):
    for
      _ <- seedPrereqs
      empty <- matches.existsMatchNo(heldEventId, MatchNoInEvent.unsafeFromInt(1))
      _ <- createMatch(sampleMatch("match_001", 1))
      _ <- createMatch(sampleMatch("match_003", 3))
      ex1 <- matches.existsMatchNo(heldEventId, MatchNoInEvent.unsafeFromInt(1))
      ex2 <- matches.existsMatchNo(heldEventId, MatchNoInEvent.unsafeFromInt(2))
    yield
      assertEquals(empty, false)
      assertEquals(ex1, true)
      assertEquals(ex2, false)

  test("update changes parent fields and replaces child player rows without deleting the match"):
    val rec = sampleMatch("match_001", 1)
    val updated = rec.copy(
      matchNoInEvent = MatchNoInEvent.unsafeFromInt(2),
      players = FourPlayers(
        playerWithIncidents("member_ponta", 1, 4, 1000, 100, destination = 0, plusStation = 0),
        player("member_akane_mami", 2, 3, 2000, 200),
        player("member_otaka", 3, 2, 3000, 300),
        player("member_eu", 4, 1, 4000, 400),
      ),
    )
    for
      _ <- seedPrereqs
      _ <- createMatch(rec)
      _ <- matches.update(updated, now.plusSeconds(60))
      found <- matches.find(rec.id)
    yield
      val got = found.getOrElse(fail("match_001 not found after update"))
      assertEquals(got.id, rec.id)
      assertEquals(got.createdAt, rec.createdAt)
      assertEquals(got.matchNoInEvent.value, 2)
      assertEquals(
        got.players.toList.sortBy(_.rank.value).map(_.memberId.value),
        List("member_eu", "member_otaka", "member_akane_mami", "member_ponta"),
      )
      val ponta = got.players.toList.find(_.memberId == MemberId.unsafeFromString("member_ponta"))
        .get
      assertEquals(ponta.totalAssetsManYen.value, 1000)
      assertEquals(ponta.incidents.destination.value, 0)

  test("update maps concurrently missing match to NotFound"):
    val rec = sampleMatch("match_missing_update", 1)
    for
      _ <- seedPrereqs
      result <- matches.update(rec, now.plusSeconds(60))
    yield assertEquals(result, Left(AppError.NotFound("match", rec.id.value)))

  test("statsByHeldEvents returns count and maximum match number including gaps"):
    val missing = HeldEventId.unsafeFromString("missing_event")
    for
      _ <- seedPrereqs
      _ <- createMatch(sampleMatch("match_stats_001", 1))
      _ <- createMatch(sampleMatch("match_stats_004", 4))
      _ <- seedSecondTitle
      _ <- createMatch(sampleMatch("match_stats_002", 2).copy(
        gameTitleId = secondGameTitleId,
        mapMasterId = secondMapMasterId,
        seasonMasterId = secondSeasonMasterId,
      ))
      stats <- matches.statsByHeldEvents(List(heldEventId, missing))
    yield
      assertEquals(stats(heldEventId).matchCount, 3)
      assertEquals(
        stats(heldEventId).scopes.toSet,
        Set(
          HeldEventScope(Some(gameTitleId), Some(seasonMasterId)),
          HeldEventScope(Some(secondGameTitleId), Some(secondSeasonMasterId)),
        )
      )
      assertEquals(stats(heldEventId).maxMatchNo, 4)
      assertEquals(stats(missing).matchCount, 0)
      assertEquals(stats(missing).maxMatchNo, 0)

  test("confirmation maps duplicate match_no_in_event to Conflict"):
    val rec1 = sampleMatch("match_confirm_001", 1)
    val rec2 = sampleMatch("match_confirm_002", 1)
    for
      _ <- seedPrereqs
      inserted <- confirmations.confirm(rec1, None, now)
      result <- confirmations.confirm(rec2, None, now)
    yield
      assertEquals(inserted, Right(MatchConfirmationResult.Confirmed))
      assertEquals(
        result,
        Left(AppError.Conflict(
          "matchNoInEvent 1 already exists for held event held_2026_04_30."
        )),
      )

  test("confirmation rolls back draft and source-image changes when match insertion conflicts"):
    val existing = sampleMatch("match_confirm_rollback_existing", 1)
    val conflicting = sampleMatch("match_confirm_rollback_conflicting", 1)
    val draftId = MatchDraftId.unsafeFromString("match-draft-confirm-rollback")
    val imageId = ImageId.unsafeFromString("image-confirm-rollback")
    val snapshot = MatchDraftConfirmation(
      draftId = draftId,
      updatedAt = now,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
    )
    val persistedState = sql"""
      SELECT d.status,
             d.confirmed_match_id,
             d.source_images_retained_until,
             d.source_images_deleted_at,
             s.status,
             s.delete_pending_at,
             (SELECT COUNT(*)::int FROM matches),
             (SELECT COUNT(*)::int FROM series_analysis_queue_outbox)
      FROM match_drafts d
      JOIN source_images s ON s.id = d.total_assets_image_id
      WHERE d.id = $draftId
    """.query[
      (
          MatchDraftStatus,
          Option[MatchId],
          Option[Instant],
          Option[Instant],
          String,
          Option[Instant],
          Int,
          Int,
      )
    ].unique.transact(transactor)
    for
      _ <- seedPrereqs
      _ <- createMatch(existing)
      _ <- insertSourceImage(imageId)
      _ <- insertMatchDraft(draftId, now, Some(imageId))
      _ <- ResultNotificationFixture.seed("match_draft", draftId.value, now).transact(transactor)
      notificationBefore <- ResultNotificationFixture.state(transactor)
      before <- persistedState
      result <- confirmations.confirm(conflicting, Some(snapshot), now.plusSeconds(2))
      after <- persistedState
      conflictingMatch <- matches.find(conflicting.id)
      notificationAfter <- ResultNotificationFixture.state(transactor)
    yield
      assertEquals(
        result,
        Left(AppError.Conflict(
          "matchNoInEvent 1 already exists for held event held_2026_04_30."
        )),
      )
      assertEquals(after, before)
      assertEquals(
        after,
        (MatchDraftStatus.DraftReady, None, None, None, "AVAILABLE", None, 1, 1),
      )
      assertEquals(conflictingMatch, None)
      assertEquals(notificationAfter, notificationBefore)

  test("confirmation from draft persists match and confirmed draft link"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-confirm-success")
    val rec = sampleMatch("match_confirm_success", 1)
    val snapshot = MatchDraftConfirmation(
      draftId = draftId,
      updatedAt = now,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
    )
    for
      _ <- seedPrereqs
      _ <- insertMatchDraft(draftId, now)
      _ <- ResultNotificationFixture.seed("match_draft", draftId.value, now).transact(transactor)
      confirmed <- confirmations.confirm(rec, Some(snapshot), now.plusSeconds(2))
      found <- matches.find(rec.id)
      status <- draftStatus(draftId)
      notification <- ResultNotificationFixture.state(transactor)
      analysisIntent <- sql"""
        SELECT s.input_revision,
               s.pending_work,
               j.input_revision,
               j.status,
               j.trigger,
               r.status,
               r.assigned_job_id = j.id,
               o.status
        FROM series_analysis_title_states s
        JOIN series_analysis_jobs j ON j.game_title_id = s.game_title_id
        JOIN series_analysis_job_requests r ON r.assigned_job_id = j.id
        JOIN series_analysis_queue_outbox o ON o.job_id = j.id
        WHERE s.game_title_id = ${rec.gameTitleId}
      """.query[(Long, Boolean, Long, String, String, String, Boolean, String)].unique
        .transact(transactor)
    yield
      assertEquals(notification, ResultNotificationFixture.cancelled("draft_unavailable"))
      assertEquals(confirmed, Right(MatchConfirmationResult.Confirmed))
      assertEquals(found.map(_.id), Some(rec.id))
      assertEquals(status, (MatchDraftStatus.Confirmed, Some(rec.id)))
      assertEquals(
        analysisIntent,
        (1L, true, 1L, "queued", "match_mutation", "pending", true, "pending"),
      )

  test("confirmation commits source-image deletion intent with the terminal draft"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-confirm-source-intent")
    val imageId = ImageId.unsafeFromString("image-confirm-source-intent")
    val rec = sampleMatch("match_confirm_source_intent", 1)
    val confirmedAt = now.plusSeconds(2)
    val snapshot = MatchDraftConfirmation(
      draftId = draftId,
      updatedAt = now,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
    )
    for
      _ <- seedPrereqs
      _ <- insertSourceImage(imageId)
      _ <- insertMatchDraft(draftId, now, Some(imageId))
      confirmed <- confirmations.confirm(rec, Some(snapshot), confirmedAt)
      lifecycle <- sql"""
        SELECT d.source_images_deleted_at, s.status, s.delete_pending_at
        FROM match_drafts d
        JOIN source_images s ON s.id = d.total_assets_image_id
        WHERE d.id = $draftId
      """.query[(Option[Instant], String, Option[Instant])].unique.transact(transactor)
    yield
      assertEquals(confirmed, Right(MatchConfirmationResult.Confirmed))
      assertEquals(lifecycle, (Some(confirmedAt), "DELETE_PENDING", Some(confirmedAt)))

  test("delete removes the confirmed draft that produced the match"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-delete-confirmed")
    val rec = sampleMatch("match_delete_confirmed", 1)
    val snapshot = MatchDraftConfirmation(
      draftId = draftId,
      updatedAt = now,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
    )
    for
      _ <- seedPrereqs
      _ <- insertMatchDraft(draftId, now)
      confirmed <- confirmations.confirm(rec, Some(snapshot), now.plusSeconds(2))
      _ <- ResultNotificationFixture.seed("match", rec.id.value, now).transact(transactor)
      deleted <- matches.delete(rec.id)
      found <- matches.find(rec.id)
      draftStillExists <- draftExists(draftId)
      notification <- ResultNotificationFixture.state(transactor)
    yield
      assertEquals(notification, ResultNotificationFixture.cancelled("match_deleted"))
      assertEquals(confirmed, Right(MatchConfirmationResult.Confirmed))
      assertEquals(deleted, true)
      assertEquals(found, None)
      assertEquals(draftStillExists, false)

  test("confirmation refuses a draft changed after the validated snapshot"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-confirm-stale")
    val rec = sampleMatch("match_confirm_stale", 1)
    val snapshot = MatchDraftConfirmation(
      draftId = draftId,
      updatedAt = now,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
    )
    for
      _ <- seedPrereqs
      _ <- insertMatchDraft(draftId, now)
      _ <- touchMatchDraft(draftId, now.plusSeconds(1))
      confirmed <- confirmations.confirm(rec, Some(snapshot), now.plusSeconds(2))
      found <- matches.find(rec.id)
      status <- draftStatus(draftId)
    yield
      assertEquals(confirmed, Right(MatchConfirmationResult.DraftSnapshotMismatch))
      assertEquals(found, None)
      assertEquals(status, (MatchDraftStatus.DraftReady, Option.empty[MatchId]))

  test("confirmation refuses a draft already confirmed by another request"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-confirm-race")
    val firstRecord = sampleMatch("match_confirm_race_first", 1)
    val secondRecord = sampleMatch("match_confirm_race_second", 2)
    val snapshot = MatchDraftConfirmation(
      draftId = draftId,
      updatedAt = now,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
    )
    for
      _ <- seedPrereqs
      _ <- insertMatchDraft(draftId, now)
      first <- confirmations.confirm(firstRecord, Some(snapshot), now.plusSeconds(2))
      second <- confirmations.confirm(secondRecord, Some(snapshot), now.plusSeconds(3))
      foundFirst <- matches.find(firstRecord.id)
      foundSecond <- matches.find(secondRecord.id)
      status <- draftStatus(draftId)
    yield
      assertEquals(first, Right(MatchConfirmationResult.Confirmed))
      assertEquals(second, Right(MatchConfirmationResult.DraftSnapshotMismatch))
      assertEquals(foundFirst.map(_.id), Some(firstRecord.id))
      assertEquals(foundSecond, None)
      assertEquals(status, (MatchDraftStatus.Confirmed, Some(firstRecord.id)))

  private def insertMatchDraft(
      draftId: MatchDraftId,
      updatedAt: Instant,
  ): IO[Int] = insertMatchDraft(draftId, updatedAt, None)

  private def insertMatchDraft(
      draftId: MatchDraftId,
      updatedAt: Instant,
      totalAssetsImageId: Option[ImageId],
  ): IO[Int] = sql"""
    INSERT INTO match_drafts (
      id, created_by_account_id, created_by_member_id, status,
      total_assets_image_id, created_at, updated_at
    ) VALUES (
      $draftId, 'account_ponta', 'member_ponta', ${MatchDraftStatus.DraftReady},
      $totalAssetsImageId, $now, $updatedAt
    )
  """.update.run.transact(transactor)

  private def insertSourceImage(id: ImageId): IO[Int] = sql"""
    INSERT INTO source_images (
      id, owner_account_id, object_key, idempotency_key_hash, status,
      media_type, byte_length, sha256_hex, width, height, available_at, created_at, updated_at
    ) VALUES (
      $id, 'account_ponta', ${s"source-images/${id.value}.png"}, ${"c" * 64}, 'AVAILABLE',
      'image/png', 128, ${"d" * 64}, 1920, 1080, $now, $now, $now
    )
  """.update.run.transact(transactor)

  private def touchMatchDraft(draftId: MatchDraftId, updatedAt: Instant): IO[Int] = sql"""
    UPDATE match_drafts
    SET match_no_in_event = 99, updated_at = $updatedAt
    WHERE id = $draftId
  """.update.run.transact(transactor)

  private def draftStatus(draftId: MatchDraftId): IO[(MatchDraftStatus, Option[MatchId])] = sql"""
    SELECT status, confirmed_match_id FROM match_drafts WHERE id = $draftId
  """.query[(MatchDraftStatus, Option[MatchId])].unique.transact(transactor)

  private def draftExists(draftId: MatchDraftId): IO[Boolean] = sql"""
    SELECT EXISTS(SELECT 1 FROM match_drafts WHERE id = $draftId)
  """.query[Boolean].unique.transact(transactor)
end PostgresMatchesRepositorySpec
