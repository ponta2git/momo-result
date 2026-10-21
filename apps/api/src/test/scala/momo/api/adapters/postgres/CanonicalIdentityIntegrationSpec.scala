package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json, Printer}
import org.http4s.circe.*
import org.http4s.{Header, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.auth.SessionCookieCodec
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv, AuthConfig, SeriesAnalysisReadConfig}
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.http.HttpAssertions.jsonField
import momo.api.http.{HttpAppTestFixtures, HttpRequestBodies}
import momo.api.integration.IntegrationSuite
import momo.api.repositories.*
import momo.api.testing.{JsonSchemaAssertions, TestImages, TestTags}
import momo.api.usecases.seriesanalysis.RequestSeriesPlayerRadarOperation

final class CanonicalIdentityIntegrationSpec extends IntegrationSuite with HttpAppTestFixtures
    with JsonSchemaAssertions:
  override protected def databaseTag: munit.Tag = TestTags.CanonicalDbIntegration
  override protected def identitySchema: PostgresIdentities = PostgresIdentities.Canonical
  private val identities = PostgresIdentities.Canonical
  private val now = Instant.parse("2026-10-18T00:00:00Z")
  private val account = AccountId.unsafeFromString("account_ponta")
  private val title = "title_world"
  private val map = "map_east"
  private val season = "season_2024_spring"
  private val held = "held-canonical-existing"
  private def fresh: String = UUID.randomUUID().toString
  private def canonical(entity: Entity, legacy: String): UUID =
    CanonicalIdentity.structured(entity, legacy).fold(error => fail(error.toString), identity)

  override protected def runtimeResource(config: AppConfig): Resource[IO, ApiApp.WiredRuntime[IO]] =
    ApiApp.wiredWithHandles[IO](config.copy(database = Some(dbFixture().databaseConfig)))

  private def seedMasters: IO[Unit] =
    val titleId = canonical(Entity.GameTitles, title)
    val mapId = canonical(Entity.MapMasters, map)
    val seasonId = canonical(Entity.SeasonMasters, season)
    val heldId = canonical(Entity.HeldEvents, held)
    (sql"""
      INSERT INTO game_titles(id, legacy_id, name, layout_family, display_order)
      VALUES ($titleId, $title, 'World', 'world', 1)
    """.update.run *>
      sql"""
      INSERT INTO series_analysis_title_states(game_title_id, algorithm_version, artifact_schema_version, validation_contract_id, notification_baseline_state)
      SELECT $titleId, algorithm_version, artifact_schema_version, validation_contract_id, 'initial'
      FROM series_analysis_release_state WHERE singleton_key = 'current'
    """.update.run *>
      sql"""
      INSERT INTO map_masters(id, legacy_id, game_title_id, name, display_order)
      VALUES ($mapId, $map, $titleId, 'East', 1)
    """.update.run *>
      sql"""
      INSERT INTO season_masters(id, legacy_id, game_title_id, name, display_order)
      VALUES ($seasonId, $season, $titleId, 'Spring', 1)
    """.update.run *>
      sql"""
      INSERT INTO held_events(id, legacy_id, held_date_iso, start_at)
      VALUES ($heldId, $held, '2026-10-18', $now)
    """.update.run).transact(transactor).void

  private def json(app: TestHttpApp, request: Request[IO]): IO[Json] = json(app, request, Status.Ok)
  private def json(app: TestHttpApp, request: Request[IO], status: Status): IO[Json] =
    app.run(request).flatMap(response =>
      response.as[Json].map { body =>
        assertEquals(response.status, status, body.noSpaces)
        body
      }
    )
  private def get(app: TestHttpApp, path: String): IO[Json] =
    json(app, readGet(Uri.unsafeFromString(path)))
  private def post(app: TestHttpApp, path: String, body: Json): IO[Json] =
    post(app, path, body, fresh)
  private def post(app: TestHttpApp, path: String, body: Json, key: String): IO[Json] =
    json(app, writePost(Uri.unsafeFromString(path), body, Some(key)))

  test("startup accepts the complete canonical schema and rejects partial or reordered contracts"):
    for
      shape <- PostgresIdentitySchema.inspect.transact(transactor)
    yield
      assertEquals(PostgresIdentitySchema.classify(shape), Right(identities))
      val missingAlias = shape.copy(columns =
        shape.columns.filterNot(column =>
          column.table == "members" && column.column == "legacy_id"
        )
      )
      val nullableAlias = shape.copy(columns =
        shape.columns.map(column =>
          if column.table == "members" && column.column == "legacy_id" then
            column.copy(notNull = false)
          else column
        )
      )
      val missingAnchor =
        shape.copy(columns = shape.columns.filterNot(_.table == "series_radar_basis_identities"))
      val wrongReplayKey = shape.copy(keys =
        shape.keys.map(key =>
          if key.table == "idempotency_keys" && key.primary then
            key.copy(columns = "account_id,key,endpoint")
          else key
        )
      )
      val wrongScope = shape.copy(foreignKeys =
        shape.foreignKeys.filterNot(key =>
          key.table == "series_radar_candidates" && key.columns == "basis_id,game_title_id"
        )
      )
      val wrongOrder =
        shape.copy(navigationIndexes = shape.navigationIndexes.filterNot(_.table == "matches"))
      List(missingAlias, nullableAlias, missingAnchor, wrongReplayKey, wrongScope, wrongOrder)
        .foreach(value => assert(PostgresIdentitySchema.classify(value).isLeft))
      val optional = shape.copy(
        columns = shape.columns.filterNot(_.table == "worker_execution_slots"),
        keys = shape.keys.filterNot(_.table == "worker_execution_slots"),
        foreignKeys = shape.foreignKeys.filterNot(_.table == "worker_execution_slots")
      )
      assertEquals(PostgresIdentitySchema.classify(optional), Right(identities))

  test("production sessions keep the legacy principal, roster and nullable member snapshot"):
    val auth = AuthConfig.defaults(AppEnv.Prod)
    tempDirectory("canonical-session").flatMap(directory =>
      runtimeResource(AppConfig(
        appEnv = AppEnv.Prod,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = directory,
        devMemberIds = List("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
        auth = auth
      ))
    ).use { wired =>
      for
        saved <- wired.handles.loginAccounts.find(AccountId.unsafeFromString(canonical(
          Entity.Accounts,
          account.value
        ).toString))
        principal = saved.getOrElse(fail("seed account missing through UUID lookup"))
        _ = assertEquals(principal.id, account)
        _ = assertEquals(principal.playerMemberId.map(_.value), Some("member_ponta"))
        session <- wired.handles.createSession(principal)
        tokens = SessionCookieCodec.decode(session.cookieValue).getOrElse(fail("invalid session"))
        me <- json(
          wired.runtime.app,
          Request[IO](Method.GET, Uri.unsafeFromString("/api/auth/me"))
            .putHeaders(Header.Raw(
              CIString("Cookie"),
              s"${auth.sessionCookieName}=${session.cookieValue}"
            ))
        )
        snapshot <-
          sql"SELECT legacy_member_id FROM app_sessions".query[Option[String]].unique.transact(
            transactor
          )
        members <- new PostgresMembersRepository[IO](transactor, identities).list
        _ =
          assertEquals(jsonField[String](me, "accountId"), account.value)
          assertEquals(jsonField[String](me, "memberId"), "member_ponta")
          assertEquals(snapshot, Some("member_ponta"))
          assertEquals(
            members.map(_.id.value).toSet,
            Set("member_ponta", "member_akane_mami", "member_otaka", "member_eu")
          )
          assert(tokens.csrfToken.nonEmpty)
      yield ()
    }

  test("fresh master UUIDs and both reference forms work; unknown nullable parents are rejected"):
    seedMasters *> httpAppResource("canonical-masters").use { app =>
      val mapId = fresh
      val newTitle = fresh
      for
        created <- post(
          app,
          "/api/game-titles",
          HttpRequestBodies.Master.createGameTitle(newTitle, "New", " MOMOTETSU_WORLD ")
        )
        mapped <- post(
          app,
          "/api/map-masters",
          HttpRequestBodies.Master.createMapMasterForTitle(
            mapId,
            canonical(Entity.GameTitles, title).toString,
            "Canonical parent"
          )
        )
        _ =
          assertEquals(jsonField[String](created, "id"), newTitle)
          assertEquals(jsonField[String](created, "layoutFamily"), "world")
          assertEquals(jsonField[String](mapped, "gameTitleId"), title)
        _ <- json(
          app,
          writePost(
            Uri.unsafeFromString("/api/game-titles"),
            HttpRequestBodies.Master.createGameTitle("new-slug", "Invalid", "world"),
            Some(fresh)
          ),
          Status.UnprocessableContent
        )
        _ <- json(
          app,
          writePost(
            Uri.unsafeFromString("/api/match-drafts"),
            HttpRequestBodies.Matches.emptyMatchDraft.mapObject(_.add(
              "heldEventId",
              Json.fromString(fresh)
            )),
            Some(fresh)
          ),
          Status.NotFound
        )
        count <- sql"SELECT count(*)::int FROM match_drafts".query[Int].unique.transact(transactor)
      yield assertEquals(count, 0)
    }

  test(
    "canonical body references preserve legacy match responses, navigation, notifications and raw replay conflicts"
  ):
    seedMasters *> httpAppResource("canonical-records").use { app =>
      val key = fresh
      val body = HttpRequestBodies.Matches.confirmMatchWithPlayers(
        canonical(Entity.HeldEvents, held).toString,
        1,
        List("member_ponta", "member_akane_mami", "member_otaka", "member_eu").zipWithIndex.map(
          (member, index) =>
            HttpRequestBodies.Matches.player(
              canonical(Entity.Members, member).toString,
              index + 1,
              index + 1
            )
        )
      ).mapObject(_.add(
        "gameTitleId",
        Json.fromString(canonical(Entity.GameTitles, title).toString)
      )
        .add("mapMasterId", Json.fromString(canonical(Entity.MapMasters, map).toString))
        .add("seasonMasterId", Json.fromString(canonical(Entity.SeasonMasters, season).toString))
        .add("ownerMemberId", Json.fromString(canonical(Entity.Members, "member_ponta").toString)))
      for
        first <- post(app, "/api/matches", body, key)
        replay <- post(app, "/api/matches", body, key)
        _ = assertEquals(first, replay)
        matchId = jsonField[String](first, "matchId")
        _ = assertEquals(jsonField[String](first, "heldEventId"), held)
        _ <- json(
          app,
          writePost(
            Uri.unsafeFromString("/api/matches"),
            body.mapObject(_.add("heldEventId", Json.fromString(held))),
            Some(key)
          ),
          Status.Conflict
        )
        direct <- new PostgresMatchDetailReadModel[IO](
          transactor,
          PostgresPublicIds.Available,
          identities
        ).find(MatchId.unsafeFromString(matchId))
        _ = assert(direct.nonEmpty)
        detail <- get(app, s"/api/matches/$matchId")
        event <- get(app, s"/api/held-events/${canonical(Entity.HeldEvents, held)}")
        listed <- get(app, s"/api/matches?heldEventId=${canonical(Entity.HeldEvents, held)}")
        publicId = jsonField[String](detail, "publicId")
        public <- get(app, s"/api/public/matches/$publicId")
        _ =
          assertEquals(jsonField[String](detail, "gameTitleId"), title)
          assertEquals(jsonField[String](public, "matchId"), matchId)
          assertEquals(jsonField[String](event, "id"), held)
          assertEquals(jsonField[List[Json]](listed, "items").size, 1)
        changed <- json(
          app,
          writePost(
            Uri.unsafeFromString(s"/api/matches/$matchId"),
            body.mapObject(_.add("matchNoInEvent", Json.fromInt(2))),
            Some(fresh)
          ).withMethod(Method.PUT)
        )
        _ <- momo.api.integration.ResultNotificationFixture.seed(
          "match",
          matchId,
          now
        ).transact(transactor)
        _ = assertEquals(jsonField[Int](changed, "matchNoInEvent"), 2)
        deleted <- app.run(writeRequest(
          Method.DELETE,
          Uri.unsafeFromString(s"/api/matches/$matchId"),
          Some(fresh)
        ))
        _ = assertEquals(deleted.status, Status.Ok)
        _ <- deleted.body.compile.drain
        notification <-
          sql"SELECT status FROM discord_notifications WHERE id = 'result:test:notification'".query[
            String
          ].unique.transact(transactor)
      yield assertEquals(notification, "CANCELLED")
    }

  test("old record URLs, cursor ties and export numbering retain exact legacy order"):
    val firstEvent = "legacy-a"
    val secondEvent = "legacy-x"
    val firstMatch = "legacy-a"
    val secondMatch = "legacy-b"
    val opaqueDraft = "historical-deleted-ocr-draft"
    def seedRecord(event: String, record: String): IO[Unit] =
      val eventId = canonical(Entity.HeldEvents, event)
      val matchId = canonical(Entity.Matches, record)
      (sql"""INSERT INTO held_events(id, legacy_id, held_date_iso, start_at)
        VALUES ($eventId, $event, '2026-10-18', $now)""".update.run *>
        sql"""INSERT INTO matches(
          id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event,
          game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
          played_at, total_assets_draft_id, created_by_account_id, created_by_member_id,
          created_at, updated_at)
        VALUES ($matchId, $record, $eventId, $event, 1,
          ${canonical(
            Entity.GameTitles,
            title
          )}, 'world', ${canonical(Entity.SeasonMasters, season)},
          ${canonical(Entity.Members, "member_ponta")}, ${canonical(Entity.MapMasters, map)},
          $now, $opaqueDraft, ${canonical(Entity.Accounts, account.value)},
          ${canonical(Entity.Members, "member_ponta")}, $now, $now)""".update.run *>
        sql"""INSERT INTO match_players(
          match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
        SELECT $matchId, member.id, player.position, player.position, 500 - player.position * 100, 0
        FROM unnest(ARRAY['member_ponta', 'member_akane_mami', 'member_otaka', 'member_eu'])
          WITH ORDINALITY player(legacy_id, position)
        JOIN members member ON member.legacy_id = player.legacy_id""".update.run).transact(
        transactor
      ).void
    for
      _ <- seedMasters *> seedRecord(firstEvent, firstMatch) *> seedRecord(secondEvent, secondMatch)
      _ <- httpAppResource("canonical-old-records").use { app =>
        val firstUuid = canonical(Entity.Matches, firstMatch).toString
        val secondUuid = canonical(Entity.Matches, secondMatch).toString
        for
          old <- get(app, s"/api/matches/$firstMatch")
          byUuid <- get(app, s"/api/matches/$firstUuid")
          public <- get(app, s"/api/public/matches/${jsonField[String](old, "publicId")}")
          event <- get(app, s"/api/held-events/${canonical(Entity.HeldEvents, firstEvent)}")
          firstPage <- get(app, "/api/matches?sort=held_asc&pageSize=1")
          cursor = jsonField[String](jsonField[Json](firstPage, "pagination"), "nextCursor")
          nextPage <- json(
            app,
            readGet(Uri.unsafeFromString("/api/matches")
              .withQueryParam("sort", "held_asc").withQueryParam("pageSize", "1")
              .withQueryParam("cursor", cursor))
          )
          exported <- new PostgresMatchExportsRepository[IO](transactor, identities).project(
            MatchExportsRepository.Selection(
              matchId = Some(MatchId.unsafeFromString(secondUuid)),
              limit = 20
            )
          )
          csv <- app.run(
            readGet(Uri.unsafeFromString(s"/api/exports/matches?format=csv&matchId=$secondUuid"))
          )
            .flatMap(response => response.as[String].map(body => response.status -> body))
          _ =
            assertEquals(byUuid, old)
            assertEquals(public, old)
            assertEquals(jsonField[String](old, "totalAssetsDraftId"), opaqueDraft)
            assertEquals(
              jsonField[String](
                jsonField[Json](jsonField[Json](old, "navigation"), "next"),
                "matchId"
              ),
              secondMatch
            )
            assertEquals(
              jsonField[String](
                jsonField[Json](jsonField[Json](event, "navigation"), "next"),
                "id"
              ),
              secondEvent
            )
            assertEquals(
              jsonField[List[Json]](firstPage, "items").map(jsonField[String](_, "id")),
              List(firstMatch)
            )
            assertEquals(
              jsonField[List[Json]](nextPage, "items").map(jsonField[String](_, "id")),
              List(secondMatch)
            )
            assertEquals(exported.size, 4)
            assert(exported.forall(row => row.seasonNo == 2 && row.gameTitleMatchNo == 2))
            assertEquals(csv._1, Status.Ok)
            assertEquals(csv._2.linesIterator.size, 5)
          update = HttpRequestBodies.Matches.confirmMatchWithNo(
            canonical(Entity.HeldEvents, firstEvent).toString,
            2
          )
            .mapObject(_.add("playedAt", Json.fromString(now.toString)).add(
              "draftIds",
              Json.obj(
                "totalAssets" -> Json.fromString(opaqueDraft),
                "revenue" -> Json.Null,
                "incidentLog" -> Json.Null
              )
            ))
          key = fresh
          updated <- json(
            app,
            writePost(
              Uri.unsafeFromString(s"/api/matches/$firstUuid"),
              update,
              Some(key)
            ).withMethod(Method.PUT)
          )
          replay <- json(
            app,
            writePost(
              Uri.unsafeFromString(s"/api/matches/$firstUuid"),
              update,
              Some(key)
            ).withMethod(Method.PUT)
          )
          refreshed <- get(app, s"/api/matches/$firstMatch")
        yield
          assertEquals(updated, replay)
          assertEquals(jsonField[String](updated, "matchId"), firstMatch)
          assertEquals(jsonField[String](updated, "heldEventId"), firstEvent)
          assertEquals(jsonField[String](refreshed, "totalAssetsDraftId"), opaqueDraft)
      }
    yield ()

  test("raw legacy replay wins, UUID aliases conflict, and both namespaces share capacity"):
    val repository = new PostgresIdempotencyRepository[IO](transactor, identities)
    val response = IdempotencyResponse(
      200,
      Map("Content-Type" -> "application/json"),
      "{\"id\":\"old-slug\"}".getBytes.toVector
    )
    val entry = IdempotencyRecord(
      "old raw key !",
      account,
      "POST /legacy",
      Vector(1.toByte, 2.toByte),
      response,
      now,
      now.plusSeconds(60)
    )
    val legacyUuid = fresh.toUpperCase
    def seed(record: IdempotencyRecord): IO[Unit] =
      import doobie.postgres.circe.jsonb.implicits.*
      val headers =
        Json.obj(record.response.headers.toList.map((key, value) => key -> Json.fromString(value))*)
      val bytes = record.response.body.toArray
      val hash = record.requestHash.toArray
      sql"""INSERT INTO idempotency_keys_legacy
        (key, account_id, endpoint, request_hash, response_status, response_headers, response_body, created_at, expires_at)
        VALUES (${record.key}, ${record.accountId.value}, ${record.endpoint}, $hash, ${record.response.status}, $headers, $bytes, ${record.createdAt}, ${record.expiresAt})
      """.update.run.transact(transactor).void
    for
      _ <- seed(entry)
      _ <- seed(entry.copy(key = legacyUuid))
      old <- repository.lookup(entry.key, account, entry.endpoint)
      replay <- repository.reserveWithinAccountLimit(entry, now, 0)
      conflict <-
        repository.reserveWithinAccountLimit(entry.copy(requestHash = Vector(3.toByte)), now, 0)
      alias <-
        repository.reserveWithinAccountLimit(entry.copy(key = legacyUuid.toLowerCase), now, 100)
      limited <- repository.reserveWithinAccountLimit(entry.copy(key = fresh), now, 2)
      invalid <- repository.reserveWithinAccountLimit(entry.copy(key = "fresh-slug"), now, 100)
      key = fresh
      pending = entry.copy(key = key, response = IdempotencyResponse(0, Map.empty, Vector.empty))
      reserved <- repository.reserveWithinAccountLimit(pending, now, 3)
      busy <- repository.reserveWithinAccountLimit(pending, now, 0)
      _ <- repository.complete(key, account, entry.endpoint, pending.requestHash, response)
      saved <- repository.lookup("{" + key.toUpperCase + "}", account, entry.endpoint)
      limitedBoth <- repository.reserveWithinAccountLimit(entry.copy(key = fresh), now, 3)
    yield
      assertEquals(old, Some(entry))
      assertEquals(replay, IdempotencyReservation.Replay(response))
      assertEquals(conflict, IdempotencyReservation.Conflict)
      assertEquals(alias, IdempotencyReservation.LegacyAliasConflict)
      assertEquals(limited, IdempotencyReservation.AccountLimitExceeded)
      assert(invalid match
        case IdempotencyReservation.InvalidKey(_) => true
        case _ => false)
      assertEquals(reserved, IdempotencyReservation.Reserved)
      assertEquals(busy, IdempotencyReservation.InProgress)
      assertEquals(saved.map(_.response), Some(response))
      assertEquals(limitedBoth, IdempotencyReservation.AccountLimitExceeded)

  test(
    "canonical analysis requests coalesce, campaign targets retain identities, and radar candidates stay inspectable"
  ):
    for
      _ <- seedMasters
      analysis <- PostgresSeriesAnalysisRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
        identities
      )
      empty <-
        analysis.status(GameTitleId.unsafeFromString(canonical(Entity.GameTitles, title).toString))
      options <- analysis.options
      requested <- analysis.requestTitleRecalculation(
        GameTitleId.unsafeFromString(canonical(Entity.GameTitles, title).toString),
        account,
        "canonical-request"
      )
      replay <- analysis.requestTitleRecalculation(
        GameTitleId.unsafeFromString(title),
        account,
        "canonical-request"
      )
      all <- analysis.requestAllRecalculation(account, "canonical-all")
      allReplay <- analysis.requestAllRecalculation(account, "canonical-all")
      overview <- analysis.adminOverview(Some(GameTitleId.unsafeFromString(canonical(
        Entity.GameTitles,
        title
      ).toString)))
      status <- analysis.status(GameTitleId.unsafeFromString(title))
      scope <- analysis.scopeStatus(SeriesAnalysisScopeStatusRequest(
        GameTitleId.unsafeFromString(canonical(Entity.GameTitles, title).toString),
        None,
        SeriesAnalysisScope.Overall
      ))
      radar <- PostgresSeriesPlayerRadarRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
        identities
      )
      command = SeriesPlayerRadarCommand(
        GameTitleId.unsafeFromString(canonical(Entity.GameTitles, title).toString),
        SeriesPlayerRadarOperationKind.Candidate,
        None,
        None,
        None,
        None,
        None
      )
      candidate <-
        RequestSeriesPlayerRadarOperation[IO](radar).run(command, account, "canonical-candidate")
      candidateReplay <-
        RequestSeriesPlayerRadarOperation[IO](radar).run(command, account, "canonical-candidate")
      state <- radar.radarState(GameTitleId.unsafeFromString(title))
      history <- radar.radarHistory(SeriesPlayerRadarHistoryRequest(
        Some(GameTitleId.unsafeFromString(canonical(Entity.GameTitles, title).toString)),
        20,
        None
      ))
      pair <- sql"""SELECT r.legacy_game_title_id, gt.legacy_id
        FROM series_analysis_job_requests r JOIN game_titles gt ON gt.id = r.game_title_id
        ORDER BY r.accepted_at, r.legacy_id LIMIT 1""".query[(
          String,
          String
      )].unique.transact(transactor)
    yield
      assert(empty.isRight, empty.toString)
      assertEquals(options.map(_.defaultGameTitleId.map(_.value)), Right(Some(title)))
      assert(requested.isRight, requested.toString)
      assertEquals(replay.map(_.requestId), requested.map(_.requestId))
      assertEquals(replay.map(_.target.flatMap(_.jobId)), requested.map(_.target.flatMap(_.jobId)))
      assert(all.isRight, all.toString)
      assertEquals(allReplay, all)
      assert(overview.isRight, overview.toString)
      assert(status.isRight, status.toString)
      assert(scope.isRight, scope.toString)
      assert(candidate.isRight, candidate.toString)
      assertEquals(candidateReplay, candidate)
      assertEquals(candidate.map(_.gameTitleId.value), Right(title))
      assert(state.isRight, state.toString)
      assert(history.isRight, history.toString)
      assertEquals(pair, title -> title)

  test(
    "existing immutable radar basis, preview and history retain bytes across canonical apply and withdrawal"
  ):
    val radarTitle = "title"
    val titleId = canonical(Entity.GameTitles, radarTitle)
    val basisId = "radar-basis-ready"
    val candidateId = "radar-candidate-ready"
    val previewId = "radar-preview-ready"
    val basisUuid = canonical(Entity.RadarBases, basisId)
    val candidateUuid = canonical(Entity.RadarCandidates, candidateId)
    val previewUuid = canonical(Entity.RadarPreviews, previewId)
    def fixture(kind: String): Json = parser.parse(
      Files.readString(repositoryFile(s"docs/schemas/fixtures/series-analysis/radar-$kind-v1.json"))
    ).fold(error => fail(error.toString), identity)
    val basis = fixture("basis").noSpaces
    val source = fixture("source").noSpaces
    val candidate = fixture("candidate").noSpaces
    val evaluation = fixture("evaluation")
    val checksum = jsonField[String](evaluation, "basisChecksum")
    val sourceChecksum =
      jsonField[String](jsonField[Json](fixture("basis"), "source"), "sourceChecksum")
    val payload = Json.obj("before" -> Json.Null, "after" -> evaluation).noSpaces
    val seed =
      (sql"""INSERT INTO game_titles(id, legacy_id, name, layout_family, display_order)
      VALUES ($titleId, $radarTitle, 'Old radar title', 'momotetsu_2', 1)""".update.run *>
        sql"""INSERT INTO series_analysis_title_states(game_title_id, algorithm_version, artifact_schema_version, validation_contract_id, notification_baseline_state)
      SELECT $titleId, algorithm_version, artifact_schema_version, validation_contract_id, 'initial'
      FROM series_analysis_release_state WHERE singleton_key = 'current'""".update.run *>
        sql"INSERT INTO series_radar_title_states(game_title_id) VALUES ($titleId)".update.run *>
        sql"""INSERT INTO series_radar_bases(id, game_title_id, checksum, payload, source_snapshot, source_checksum, source_input_revision)
        VALUES ($basisId, $radarTitle, $checksum, $basis::jsonb, $source::jsonb, $sourceChecksum, 0)""".update.run *>
        sql"""INSERT INTO series_radar_basis_identities(id, legacy_id, game_title_id, legacy_game_title_id)
        VALUES ($basisUuid, $basisId, $titleId, $radarTitle)""".update.run *>
        sql"""INSERT INTO series_radar_candidates(id, legacy_id, game_title_id, legacy_game_title_id, basis_id, status, result, source_input_revision)
        VALUES ($candidateUuid, $candidateId, $titleId, $radarTitle, $basisUuid, 'ready', $candidate::jsonb, 0)""".update.run *>
        sql"""INSERT INTO series_radar_previews(id, legacy_id, game_title_id, candidate_id, before_basis_id, input_revision, status, evaluation_snapshot, scope_keys)
        VALUES ($previewUuid, $previewId, $titleId, $candidateUuid, NULL, 0, 'ready', $source::jsonb, ARRAY['overall'])""".update.run *>
        sql"""INSERT INTO series_radar_preview_scopes(preview_id, scope_key, payload)
        VALUES ($previewUuid, 'overall', $payload::jsonb)""".update.run).transact(transactor).void
    for
      _ <- seed
      _ <- List("history-a", "history-b", "history-c").traverse_ { legacy =>
        val operationId = canonical(Entity.RadarOperations, legacy)
        val accountId = canonical(Entity.Accounts, account.value)
        (sql"""INSERT INTO series_radar_operations(id, legacy_id, game_title_id, legacy_game_title_id, kind, status,
          candidate_id, preview_id, basis_id, requested_by, legacy_requested_by, requested_by_display_name,
          idempotency_key_hash, request_fingerprint, finished_at)
          VALUES ($operationId, $legacy, $titleId, $radarTitle, 'apply', 'succeeded',
            $candidateUuid, $previewUuid, $basisUuid, $accountId, ${account.value}, 'Historical actor', $legacy, $legacy, $now)""".update.run *>
          sql"""INSERT INTO series_radar_revisions(operation_id, game_title_id, candidate_id, after_basis_id, change_kind,
            requested_by, requested_by_display_name, published_at)
            VALUES ($legacy, $radarTitle, $candidateId, $basisId, 'generated', ${account.value}, 'Historical actor', $now)""".update.run).transact(
          transactor
        ).void
      }
      before <-
        sql"SELECT payload::text, source_snapshot::text FROM series_radar_bases WHERE id = $basisId".query[
          (String, String)
        ].unique.transact(transactor)
      radar <- PostgresSeriesPlayerRadarRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
        identities
      )
      analysis <- PostgresSeriesAnalysisRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
        identities
      )
      requested <- analysis.requestTitleRecalculation(
        GameTitleId.unsafeFromString(titleId.toString),
        account,
        "radar-queued"
      )
      preview <- radar.radarPreview(SeriesPlayerRadarPreviewRequest(
        GameTitleId.unsafeFromString(titleId.toString),
        previewUuid.toString,
        SeriesAnalysisScope.Overall
      ))
      command = SeriesPlayerRadarCommand(
        GameTitleId.unsafeFromString(titleId.toString),
        SeriesPlayerRadarOperationKind.Apply,
        Some(candidateUuid.toString),
        Some(previewUuid.toString),
        None,
        None,
        None
      )
      applied <- RequestSeriesPlayerRadarOperation[IO](radar).run(command, account, "radar-apply")
      replay <- RequestSeriesPlayerRadarOperation[IO](radar).run(command, account, "radar-apply")
      state <- radar.radarState(GameTitleId.unsafeFromString(radarTitle))
      withdrawn <- RequestSeriesPlayerRadarOperation[IO](radar).run(
        command.copy(kind = SeriesPlayerRadarOperationKind.Withdraw, previewId = None),
        account,
        "radar-withdraw"
      )
      desired <-
        sql"SELECT desired_basis_id::text, active_operation_id::text FROM series_radar_title_states WHERE game_title_id = $titleId".query[
          (Option[String], Option[String])
        ].unique.transact(transactor)
      after <-
        sql"SELECT payload::text, source_snapshot::text FROM series_radar_bases WHERE id = $basisId".query[
          (String, String)
        ].unique.transact(transactor)
      history <- radar.radarHistory(SeriesPlayerRadarHistoryRequest(
        Some(GameTitleId.unsafeFromString(titleId.toString)),
        2,
        None
      ))
      next <- radar.radarHistory(SeriesPlayerRadarHistoryRequest(
        Some(GameTitleId.unsafeFromString(titleId.toString)),
        2,
        Some(canonical(Entity.RadarOperations, "history-b").toString)
      ))
      detail <- radar.radarRevision(canonical(Entity.RadarOperations, "history-c").toString)
    yield
      assert(requested.isRight, requested.toString)
      assert(preview.isRight, preview.toString)
      assert(applied.isRight, applied.toString)
      assertEquals(replay, applied)
      assertEquals(applied.map(_.candidateId), Right(Some(candidateId)))
      assert(state.isRight, state.toString)
      assertEquals(withdrawn.map(_.status), Right("succeeded"))
      assertEquals(desired, None -> None)
      assertEquals(after, before)
      def document(value: Either[momo.api.errors.AppError, SeriesPlayerRadarDocument]): Json =
        value.toOption.map(doc =>
          parser.parse(new String(doc.payload, StandardCharsets.UTF_8)).fold(
            error => fail(error.toString),
            identity
          )
        ).getOrElse(fail(value.toString))
      assertEquals(document(history).hcursor.get[String]("nextCursor"), Right("history-b"))
      assertEquals(document(next).hcursor.get[List[Json]]("items").map(_.size), Right(1))
      assertEquals(
        document(
          detail
        ).hcursor.downField("revision").downField("appliedBy").get[String]("displayName"),
        Right("Historical actor")
      )
      assertEquals(document(detail).hcursor.downField("afterBasis").focus, Some(fixture("basis")))

  test(
    "canonical OCR admission preserves opaque image IDs and retained draft-job pairs through cancellation"
  ):
    seedMasters *> httpAppResource("canonical-ocr").use { app =>
      val uploadKey = fresh
      val submissionId = fresh
      for
        draft <- post(
          app,
          "/api/match-drafts",
          HttpRequestBodies.Matches.matchDraftForHeldEvent(canonical(
            Entity.HeldEvents,
            held
          ).toString)
        )
        draftId = jsonField[String](draft, "matchDraftId")
        upload <- uploadPngRequestWithIdempotency(uploadKey)
        image <- json(app, upload)
        imageId = jsonField[String](image, "imageId")
        opaqueImage = "historical-image-object"
        _ <-
          sql"UPDATE source_images SET legacy_id = $opaqueImage WHERE id = ${UUID.fromString(imageId)}".update.run.transact(
            transactor
          )
        submission = Json.obj(
          "matchDraftId" -> Json.fromString(draftId),
          "members" -> Json.arr(Json.obj(
            "screenType" -> Json.fromString("total_assets"),
            "uploadIdempotencyKey" -> Json.fromString(uploadKey),
            "imageSha256" ->
              Json.fromString(momo.api.ports.storage.Sha256Hex.digest(TestImages.png1x1).value),
            "imageByteLength" -> Json.fromInt(TestImages.png1x1.length)
          ))
        )
        _ <- json(
          app,
          writeRequest(
            Method.PUT,
            Uri.unsafeFromString(s"/api/ocr-submissions/$submissionId")
          ).withEntity(submission)
        )
        body = HttpRequestBodies.Matches.createOcrJob(imageId, "total_assets", submissionId)
        accepted <- json(
          app,
          writePost(Uri.unsafeFromString("/api/ocr-jobs"), body, Some(fresh)),
          Status.Ok
        )
        replay <- json(
          app,
          writePost(Uri.unsafeFromString("/api/ocr-jobs"), body, Some(fresh)),
          Status.Ok
        )
        _ = assertEquals(replay, accepted)
        jobId = jsonField[String](accepted, "jobId")
        stored <-
          sql"SELECT image_id, image_path, legacy_draft_id FROM ocr_jobs WHERE legacy_id = $jobId".query[(
              String,
              String,
              String
          )].unique.transact(transactor)
        pair <- sql"SELECT legacy_job_id FROM ocr_drafts WHERE legacy_id = ${stored._3}".query[
          String
        ].unique.transact(transactor)
        reviewed <- get(app, s"/api/match-drafts/$draftId/review")
        _ =
          assertEquals(stored._1, opaqueImage)
          assertEquals(pair, jobId)
          assert(reviewed.isObject)
        cancelled <- app.run(writeRequest(
          Method.POST,
          Uri.unsafeFromString(s"/api/match-drafts/$draftId/cancel"),
          Some(fresh)
        ))
        _ = assertEquals(cancelled.status, Status.Ok)
        _ <- cancelled.body.compile.drain
        state <- sql"SELECT status FROM ocr_submissions WHERE legacy_id = $submissionId".query[
          String
        ].unique.transact(transactor)
      yield assertEquals(state, "aborted")
    }

  test(
    "HTTP replays a retained non-UUID master request before fresh validation and preserves stored bytes"
  ):
    httpAppResource("canonical-old-replay").use { app =>
      val key = "old master key !"
      val body = HttpRequestBodies.Master.createGameTitle("historical-title", "Historical", "world")
      val requestHash = MessageDigest.getInstance("SHA-256").digest(Printer(
        dropNullValues = false,
        indent = "",
        sortKeys = true
      ).print(body).getBytes(StandardCharsets.UTF_8))
      val response = Json.obj(
        "id" -> Json.fromString("historical-title"),
        "name" -> Json.fromString("Historical"),
        "layoutFamily" -> Json.fromString("world"),
        "displayOrder" -> Json.fromInt(1),
        "createdAt" -> Json.fromString("2024-01-01T00:00:00Z")
      )
      val responseBytes = ("  " + response.spaces2 + "\n").getBytes(StandardCharsets.UTF_8)
      for
        timestamp <- IO.realTimeInstant
        _ <-
          sql"""INSERT INTO idempotency_keys_legacy
          (key, account_id, endpoint, request_hash, response_status, response_headers, response_body, created_at, expires_at)
          VALUES ($key, 'account_ponta', 'POST /api/game-titles', $requestHash, 200, '{"Content-Type":"application/json"}'::jsonb,
            $responseBytes, $timestamp, ${timestamp.plusSeconds(
              3600
            )})""".update.run.transact(transactor)
        replay <- post(app, "/api/game-titles", body, key)
        _ <- json(
          app,
          writePost(
            Uri.unsafeFromString("/api/game-titles"),
            body.mapObject(_.add("id", Json.fromString(fresh))),
            Some(key)
          ),
          Status.Conflict
        )
        _ <- json(
          app,
          writePost(Uri.unsafeFromString("/api/game-titles"), body, Some("new master key !")),
          Status.UnprocessableContent
        )
        stored <-
          sql"SELECT response_body FROM idempotency_keys_legacy WHERE key = $key".query[Array[
            Byte
          ]].unique.transact(transactor)
        effects <- sql"SELECT count(*)::int FROM game_titles".query[Int].unique.transact(transactor)
      yield
        assertEquals(replay, response)
        assertEquals(stored.toVector, responseBytes.toVector)
        assertEquals(effects, 0)
    }

  test("canonical artifact anchors serve immutable aggregate bytes and legacy scope identities"):
    val artifactId = "artifact-existing-before-cutover"
    val artifactUuid = canonical(Entity.AnalysisArtifacts, artifactId)
    val titleId = canonical(Entity.GameTitles, title)
    val payload = Files.readAllBytes(
      repositoryFile("docs/schemas/fixtures/series-analysis/aggregate-payload-v6.json")
    )
    val size = payload.length
    def checksum(value: Array[Byte]): String = "sha256:" +
      MessageDigest.getInstance("SHA-256").digest(value).map(byte => f"${byte & 0xff}%02x").mkString
    def depth(value: Json): Int = value.arrayOrObject(
      1,
      values => 1 + values.map(depth).maxOption.getOrElse(0),
      fields => 1 + fields.values.map(depth).maxOption.getOrElse(0)
    )
    val nesting = parser.parse(new String(payload, StandardCharsets.UTF_8)).fold(
      error => fail(error.toString),
      depth
    )
    val hash = checksum(payload)
    val inventoryPayload = "{}".getBytes(StandardCharsets.UTF_8)
    val inventoryHash = checksum(inventoryPayload)
    for
      _ <- seedMasters
      _ <-
      (sql"""INSERT INTO series_analysis_artifacts(
        id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
        validation_contract_id, source_input_checksum, root_checksum, status,
        aggregate_chunk_count, review_chunk_count, drilldown_chunk_count, match_context_chunk_count,
        outlook_summary_chunk_count, outlook_reference_chunk_count, encoded_bytes, decoded_bytes, scope_keys)
        VALUES ($artifactId, $title, 0, 'series-analysis-v7', 6, NULL,
          ${"sha256:" + "c" * 64}, ${"sha256:" + "d" * 64}, 'staging',
          1, 0, 0, 0, 1, 4, ${size + 10}, ${size + 10}, ARRAY['overall'])""".update.run *>
        sql"""INSERT INTO series_analysis_scope_aggregate_artifacts
          (artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum)
          VALUES ($artifactId, 'overall', 'overall', $payload, $size, $size, 0, $nesting, $hash)""".update.run *>
        sql"""INSERT INTO series_analysis_outlook_summary_artifacts
          (artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum)
          VALUES ($artifactId, 'overall', 'overall', $inventoryPayload, 2, 2, 0, 1, $inventoryHash)""".update.run *>
        sql"""INSERT INTO series_analysis_outlook_reference_artifacts
          (artifact_id, scope_key, scope_kind, member_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum)
          SELECT $artifactId, 'overall', 'overall', legacy_id, $inventoryPayload, 2, 2, 1, 1, $inventoryHash FROM members""".update.run *>
        sql"""UPDATE series_analysis_artifacts SET validation_contract_id = 'series-analysis-artifact-v6-full-validation-v2'
          WHERE id = $artifactId AND status = 'staging'""".update.run *>
        sql"""UPDATE series_analysis_artifacts SET status = 'published', published_at = now()
          WHERE id = $artifactId AND status = 'staging'""".update.run *>
        sql"""INSERT INTO series_analysis_artifact_identities(id, legacy_id, game_title_id, legacy_game_title_id)
          VALUES ($artifactUuid, $artifactId, $titleId, $title)""".update.run *>
        sql"""UPDATE series_analysis_title_states SET current_artifact_id = $artifactUuid, pending_work = false
          WHERE game_title_id = $titleId""".update.run).transact(transactor)
      analysis <- PostgresSeriesAnalysisRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
        identities
      )
      status <- analysis.status(GameTitleId.unsafeFromString(titleId.toString))
      chunk <- analysis.chunk(SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Aggregate,
        GameTitleId.unsafeFromString(titleId.toString),
        artifactUuid.toString,
        SeriesAnalysisScope.Overall
      ))
      scope <- analysis.scopeStatus(SeriesAnalysisScopeStatusRequest(
        GameTitleId.unsafeFromString(titleId.toString),
        Some(artifactUuid.toString),
        SeriesAnalysisScope.Overall
      ))
      stored <-
        sql"SELECT payload FROM series_analysis_scope_aggregate_artifacts WHERE artifact_id = $artifactId".query[
          Array[Byte]
        ].unique.transact(transactor)
    yield
      assert(status.isRight, status.toString)
      assert(scope.isRight, scope.toString)
      val hydrated = chunk.toOption.map(value =>
        parser.parse(new String(value.payload, StandardCharsets.UTF_8)).fold(
          error => fail(error.toString),
          identity
        )
      ).getOrElse(fail(chunk.toString))
      assertEquals(
        hydrated.hcursor.downField("artifact").get[String]("artifactId"),
        Right(artifactId)
      )
      assertEquals(stored.toVector, payload.toVector)
