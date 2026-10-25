package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json}
import org.http4s.circe.*
import org.http4s.{Method, Status, Uri}

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, SeriesAnalysisReadConfig}
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.http.HttpAppTestFixtures
import momo.api.integration.IntegrationSuite
import momo.api.repositories.{MatchConfirmationResult, MatchDraftConfirmation}
import momo.api.testing.TestTags
import momo.api.usecases.testing.MatchFixtures

final class PostgresAchievementsRepositorySpec extends IntegrationSuite with HttpAppTestFixtures:
  override protected def databaseTag: munit.Tag = TestTags.CanonicalDbIntegration
  override protected def identitySchema: PostgresIdentities = PostgresIdentities.Canonical
  override protected def runtimeResource(config: AppConfig): Resource[IO, ApiApp.WiredRuntime[IO]] =
    ApiApp.wiredWithHandles[IO](config.copy(database = Some(dbFixture().databaseConfig)))
  private val now = Instant.parse("2026-10-24T05:00:00Z")
  private val account = AccountId.unsafeFromString("account_ponta")
  private val context = AchievementMutationContext(account, now)
  private val memberValues = MatchFixtures.DbMemberValues
  private val member = MemberId.unsafeFromString(memberValues.head)
  private def fresh: String = UUID.randomUUID().toString
  private case class World(
      title: GameTitleId,
      map: MapMasterId,
      season: SeasonMasterId,
      event: HeldEventId
  )
  private def worlds: PostgresGameTitlesRepository[IO] =
    new PostgresGameTitlesRepository(transactor, identitySchema)
  private def maps: PostgresMapMastersRepository[IO] =
    new PostgresMapMastersRepository(transactor, identitySchema)
  private def matches: PostgresMatchesRepository[IO] =
    new PostgresMatchesRepository(transactor, identitySchema)
  private def confirmations: PostgresMatchConfirmationRepository[IO] =
    new PostgresMatchConfirmationRepository(transactor, identitySchema)
  private def repository: IO[PostgresAchievementsRepository[IO]] =
    PostgresSeriesAnalysisRepository.create[IO](
      transactor,
      SeriesAnalysisReadConfig.defaults,
      identitySchema
    )
      .map(new PostgresAchievementsRepository(transactor, _, identitySchema))
  private def isConflict(error: AppError): Boolean = error match
    case AppError.Conflict(_) => true
    case _ => false
  private def right[A](result: Either[AppError, A]): A =
    result.fold(error => fail(error.toString), identity)
  private def seed: IO[World] =
    val world = World(
      GameTitleId.unsafeFromString(fresh),
      MapMasterId.unsafeFromString(fresh),
      SeasonMasterId.unsafeFromString(fresh),
      HeldEventId.unsafeFromString(fresh)
    )
    for
      _ <- worlds.createWithNextDisplayOrder(GameTitle(
        world.title,
        s"桃鉄2 ${world.title.value}",
        "momotetsu_2",
        1,
        now
      )).map(right)
      _ <-
        maps.createWithNextDisplayOrder(MapMaster(world.map, world.title, "東日本", 1, now)).map(right)
      _ <- new PostgresSeasonMastersRepository[IO](transactor, identitySchema)
        .createWithNextDisplayOrder(SeasonMaster(
          world.season,
          world.title,
          "2026",
          1,
          now
        )).map(right)
      _ <- new PostgresHeldEventsRepository[IO](transactor, identities = identitySchema)
        .create(HeldEvent(world.event, now))
    yield world
  private def definition(world: World): CreateAchievement =
    CreateAchievement(
      world.title,
      "手動実績",
      "条件",
      false,
      List(world.map),
      AchievementRule.Manual,
      None,
      2
    )
  private def record(world: World, number: Int): MatchRecord =
    MatchFixtures.matchRecord(
      MatchId.unsafeFromString(fresh),
      world.event,
      number,
      world.title,
      world.season,
      world.map,
      now.minusSeconds(7200),
      now,
      memberValues,
      None,
      None,
      None
    )
      .copy(createdByAccountId = account, layoutFamily = "momotetsu_2")
  private def revision(world: World): IO[Long] =
    sql"SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = ${UUID.fromString(world.title.value)}"
      .query[Long].unique.transact(transactor)
  private def claims(
      repo: PostgresAchievementsRepository[IO],
      world: World
  ): IO[List[AchievementClaim]] =
    repo.catalog(world.title).map(value => right(value).claims)
  private def legacyAutomaticClaim(item: UUID): IO[Unit] =
    val id = UUID.randomUUID()
    val generation = UUID.randomUUID()
    sql"""INSERT INTO achievement_claims
      (id, item_id, member_id, source_kind, state, generation_id,
       version, updated_by_account_id, updated_at)
      SELECT $id, $item, m.id, 'import', 'unconfirmed', $generation, 1, a.id, $now
      FROM members m CROSS JOIN momo_login_accounts a
      WHERE m.id = ${identitySchema.lookup(Entity.Members, member.value)}
        AND a.id = ${identitySchema.lookup(Entity.Accounts, account.value)}
    """.update.run.void.transact(transactor)
  private def change(record: MatchRecord): MatchUpdate = MatchFixtures.update(record)
    .copy(expectedVersion = Some(record.analysisRevision), updatedByAccountId = Some(account))

  test("saved order includes retired items, appends additions and rejects concurrent stale orders"):
    for
      world <- seed
      repo <- repository
      first <- repo.create(definition(world).copy(name = "First"), context).map(right)
      second <- repo.create(definition(world).copy(name = "Second"), context).map(right)
      retired <- repo.create(definition(world).copy(name = "Retired"), context).map(right)
      _ <- repo.retire(retired.id, retired.version, context).map(right)
      initial <- repo.catalog(world.title).map(right)
      before <- revision(world)
      command = ReorderAchievements(
        world.title,
        initial.orderRevision,
        List(second.id, first.id, retired.id)
      )
      competing <- (
        repo.reorder(command),
        repo.reorder(command.copy(
          achievementIds = List(first.id, retired.id, second.id)
        ))
      ).parTupled
      ordered <- repo.catalog(world.title).map(right)
      after <- revision(world)
      versions = initial.items.map(item => item.id -> item.version).toMap
      _ <- repo.update(
        first.id,
        UpdateAchievement("Renamed", first.notes, first.stars, first.version),
        context
      )
        .map(right)
      afterRename <- repo.catalog(world.title).map(right)
      incomplete <- repo.reorder(ReorderAchievements(
        world.title,
        ordered.orderRevision,
        List(first.id, second.id)
      ))
      foreign <- repo.reorder(ReorderAchievements(
        world.title,
        ordered.orderRevision,
        List(first.id, second.id, UUID.randomUUID())
      ))
      _ <- repo.retire(second.id, second.version, context).map(right)
      retirementConflict <- repo.reorder(ReorderAchievements(
        world.title,
        ordered.orderRevision,
        ordered.items.map(_.id)
      ))
      afterRetirement <- repo.catalog(world.title).map(right)
      added <- repo.create(definition(world).copy(name = "Added"), context).map(right)
      stale <- repo.reorder(ReorderAchievements(
        world.title,
        afterRetirement.orderRevision,
        afterRetirement.items.map(_.id)
      ))
      current <- repo.catalog(world.title).map(right)
    yield
      assertEquals(initial.items.map(_.id), List(first.id, second.id, retired.id))
      assertEquals(List(competing._1, competing._2).count(_.isRight), 1)
      assertEquals(List(competing._1, competing._2).count(_.left.exists(isConflict)), 1)
      assertEquals(ordered.items.map(_.sortOrder), List(0, 1, 2))
      assertEquals(ordered.items.map(item => item.id -> item.version).toMap, versions)
      assertEquals(after, before)
      assertEquals(afterRename.orderRevision, ordered.orderRevision)
      assert(incomplete.left.exists(isConflict))
      assert(foreign.left.exists(isConflict))
      assert(retirementConflict.left.exists(isConflict))
      assert(stale.left.exists(isConflict))
      assertEquals(current.items.last.id, added.id)
      assertEquals(current.items.dropRight(1).map(_.id), ordered.items.map(_.id))
      assertEquals(added.appliesFrom, None)

  test("new manual definitions accept and keep evidence from matches before their creation"):
    for
      world <- seed
      repo <- repository
      matched = record(world, 1).copy(playedAt = Instant.parse("2020-01-02T03:04:05Z"))
      _ <- confirmations.confirm(matched, None, now).map(right)
      item <- repo.create(definition(world), context).map(right)
      // The retained compatibility column must not reintroduce eligibility on an older row.
      _ <- sql"UPDATE achievement_items SET applies_from = DATE '2026-10-24' WHERE id = ${item.id}"
        .update.run.transact(transactor)
      _ <- repo.addToMatch(
        matched.id,
        AddMatchAchievements(
          0,
          List(
            AddMatchAchievement(item.id, member, item.version, None)
          )
        ),
        context
      ).map(right)
      old <- claims(repo, world).map(_.head)
      earlier = matched.copy(playedAt = Instant.parse("2019-01-02T03:04:05Z"))
      _ <- matches.update(matched.id, change(earlier), now.plusSeconds(1)).map(right)
      followed <- claims(repo, world).map(_.head)
    yield
      assertEquals(old.matchId, Some(matched.id))
      assertEquals(old.achievedAt, Some(matched.playedAt))
      assertEquals(followed.matchId, Some(matched.id))
      assertEquals(followed.achievedAt, Some(earlier.playedAt))

  test("concurrent additions cannot exceed the catalog limit"):
    for
      world <- seed
      repo <- repository
      title = UUID.fromString(world.title.value)
      _ <- sql"""INSERT INTO achievement_items
        (id, game_title_id, name, notes, rule_kind, stars, scope_kind, sort_order)
        SELECT gen_random_uuid(), $title, '既存の実績', '', 'manual', 1, 'common', position
        FROM generate_series(0, 4094) AS position
      """.update.run.transact(transactor)
      results <- (
        repo.create(definition(world).copy(name = "Last A"), context),
        repo.create(definition(world).copy(name = "Last B"), context),
      ).parTupled
      count <- sql"SELECT count(*) FROM achievement_items WHERE game_title_id = $title"
        .query[Long].unique.transact(transactor)
    yield
      assertEquals(List(results._1, results._2).count(_.isRight), 1)
      assertEquals(List(results._1, results._2).count(_.left.exists(isConflict)), 1)
      assertEquals(count, 4096L)

  test("unchanged claim corrections preserve history and comparison but still reject stale inputs"):
    for
      world <- seed
      repo <- repository
      item <- repo.create(definition(world), context).map(right)
      matched = record(world, 1)
      _ <- confirmations.confirm(
        matched,
        None,
        now,
        List(AddMatchAchievement(item.id, member, item.version, None))
      ).map(right)
      previous <- claims(repo, world).map(_.head)
      before <- revision(world)
      title = UUID.fromString(world.title.value)
      candidate = UUID.randomUUID()
      preview = UUID.randomUUID()
      _ <-
      (sql"""INSERT INTO series_radar_candidates
        (id, legacy_id, game_title_id, legacy_game_title_id, status)
        VALUES ($candidate, ${candidate.toString}, $title, ${world.title.value}, 'ready')
      """.update.run *>
        sql"""INSERT INTO series_radar_previews
          (id, legacy_id, game_title_id, candidate_id, input_revision, status)
          VALUES ($preview, ${preview.toString}, $title, $candidate, $before, 'ready')
        """.update.run).transact(transactor)
      command = CorrectAchievementClaim(
        previous.version,
        item.version,
        "achieved",
        Some(matched.id),
        None,
        Some(matched.analysisRevision)
      )
      unchanged <- repo.correctClaim(previous.id, command, context.copy(at = now.plusSeconds(1)))
        .map(right)
      stale <- List(
        command.copy(expectedVersion = previous.version + 1),
        command.copy(expectedItemVersion = item.version + 1),
        command.copy(expectedMatchVersion = Some(matched.analysisRevision + 1)),
      ).traverse(repo.correctClaim(previous.id, _, context))
      afterNoChange <- revision(world)
      previewBefore <- sql"SELECT status FROM series_radar_previews WHERE id = $preview"
        .query[String].unique.transact(transactor)
      corrected <- repo.correctClaim(
        previous.id,
        command.copy(matchId = None, expectedMatchVersion = None),
        context.copy(at = now.plusSeconds(2))
      ).map(right)
      afterChange <- revision(world)
      previewAfter <- sql"SELECT status FROM series_radar_previews WHERE id = $preview"
        .query[String].unique.transact(transactor)
    yield
      assertEquals(unchanged, previous)
      assert(stale.forall(_.left.exists(isConflict)))
      assertEquals(afterNoChange, before)
      assertEquals(previewBefore, "ready")
      assertEquals(corrected.version, previous.version + 1)
      assertEquals(corrected.generationId, previous.generationId)
      assertEquals(corrected.matchId, None)
      assertEquals(corrected.achievedAt, previous.achievedAt)
      assertEquals(afterChange, before + 1)
      assertEquals(previewAfter, "stale")

  test(
    "confirmation and result edits roll back their changes when an achievement snapshot is stale"
  ):
    for
      world <- seed
      repo <- repository
      item <- repo.create(definition(world), context).map(right)
      matched = record(world, 1)
      draft = UUID.randomUUID()
      actor <- identityMode.requireReference(Entity.Accounts, account.value).transact(transactor)
      _ <-
        sql"""INSERT INTO match_drafts(id, legacy_id, created_by_account_id, status, created_at, updated_at)
        VALUES ($draft, ${draft.toString}, $actor, 'draft_ready', $now, $now)""".update.run.transact(
          transactor
        )
      expected = Some(MatchDraftConfirmation(
        MatchDraftId.unsafeFromString(draft.toString),
        now,
        None,
        None,
        None
      ))
      addition = AddMatchAchievement(item.id, member, item.version + 1, None)
      before <- revision(world)
      rejected <- confirmations.confirm(matched, expected, now, List(addition))
      absent <- matches.find(matched.id)
      draftBefore <-
        sql"SELECT status FROM match_drafts WHERE id = $draft".query[String].unique.transact(
          transactor
        )
      claimsBefore <- claims(repo, world)
      afterReject <- revision(world)
      confirmed <- confirmations.confirm(
        matched,
        expected,
        now,
        List(addition.copy(expectedItemVersion = item.version))
      )
      draftAfter <- sql"SELECT status, confirmed_match_id::text FROM match_drafts WHERE id = $draft"
        .query[(String, Option[String])].unique.transact(transactor)
      stored <- matches.find(matched.id)
      saved <- claims(repo, world)
      after <- revision(world)
      staleEdit <- matches.update(
        matched.id,
        change(stored.get.copy(playedAt = now.minusSeconds(3600))).copy(achievements =
          List(addition.copy(expectedItemVersion = item.version))
        ),
        now.plusSeconds(1)
      )
      afterEdit <- matches.find(matched.id)
      claimsAfterEdit <- claims(repo, world)
      revisionAfterEdit <- revision(world)
    yield
      assert(rejected.left.exists(isConflict))
      assertEquals(absent, None)
      assertEquals(draftBefore, "draft_ready")
      assertEquals(claimsBefore, Nil)
      assertEquals(afterReject, before)
      assertEquals(confirmed, Right(MatchConfirmationResult.Confirmed))
      assertEquals(draftAfter, ("confirmed", Some(matched.id.value)))
      assertEquals(stored.map(_.players.toList.size), Some(4))
      assertEquals(saved.map(_.matchId), List(Some(matched.id)))
      assertEquals(after, before + 1)
      assert(staleEdit.left.exists(isConflict))
      assertEquals(afterEdit, stored)
      assertEquals(claimsAfterEdit, saved)
      assertEquals(revisionAfterEdit, after)

  test(
    "achievement-only writes preserve results while match corrections follow or unlink evidence"
  ):
    for
      world <- seed
      repo <- repository
      item <- repo.create(definition(world), context).map(right)
      matched = record(world, 1)
      _ <- confirmations.confirm(matched, None, now).map(right)
      original <- matches.find(matched.id).map(_.get)
      before <- revision(world)
      stale <- repo.addToMatch(
        matched.id,
        AddMatchAchievements(1, List(AddMatchAchievement(item.id, member, 1, None))),
        context
      )
      _ <- repo.addToMatch(
        matched.id,
        AddMatchAchievements(0, List(AddMatchAchievement(item.id, member, 1, None))),
        context
      ).map(right)
      untouched <- matches.find(matched.id)
      first <- claims(repo, world).map(_.head)
      after <- revision(world)
      shifted <- matches.update(
        matched.id,
        change(original.copy(playedAt = now.minusSeconds(3600))),
        now.plusSeconds(1)
      ).map(right)
      followed <- claims(repo, world).map(_.head)
      otherMap = MapMasterId.unsafeFromString(fresh)
      _ <-
        maps.createWithNextDisplayOrder(MapMaster(otherMap, world.title, "西日本", 2, now)).map(right)
      moved <- matches.update(
        matched.id,
        change(shifted.copy(mapMasterId = otherMap)),
        now.plusSeconds(2)
      ).map(right)
      unlinked <- claims(repo, world).map(_.head)
      _ <- matches.delete(moved.id, Some(account))
      retained <- claims(repo, world).map(_.head)
    yield
      assert(stale.left.exists(isConflict))
      assertEquals(untouched, Some(original))
      assertEquals(after, before + 1)
      assertEquals(followed.achievedAt, Some(shifted.playedAt))
      assertEquals(followed.generationId, first.generationId)
      assertEquals(unlinked.matchId, None)
      assertEquals(unlinked.achievedAt, followed.achievedAt)
      assertEquals(unlinked.version, followed.version + 1)
      assertEquals(retained, unlinked)

  test(
    "initial imports never resurrect cancelled roots and manual retirement captures the current generation"
  ):
    for
      world <- seed
      repo <- repository
      parentId = UUID.randomUUID()
      childId = UUID.randomUUID()
      initial = AchievementInitialization(
        List(
          InitialAchievementItem(parentId, "momotetsu2-patrol-four", definition(world)),
          InitialAchievementItem(
            childId,
            "momotetsu2-patrol-dubbing-four",
            definition(world).copy(name = "下位実績")
          )
        ),
        List(InitialAchievementClaim(parentId, member, "achieved"))
      )
      _ <- PostgresAchievementInitialization.initialize(
        initial,
        context,
        identitySchema
      ).transact(transactor)
      imported <- claims(repo, world).map(_.head)
      cancelled <- repo.correctClaim(
        imported.id,
        CorrectAchievementClaim(imported.version, 1, "cancelled", None, None, None),
        context
      ).map(right)
      _ <- PostgresAchievementInitialization.initialize(
        initial,
        context,
        identitySchema
      ).transact(transactor)
      preserved <- claims(repo, world).map(_.find(_.id.equals(imported.id)).get)
      matched = record(world, 1)
      _ <- confirmations.confirm(
        matched,
        None,
        now,
        List(AddMatchAchievement(parentId, member, 1, None))
      ).map(right)
      direct <- claims(repo, world).map(_.find(_.sourceKind == "direct").get)
      retired <- repo.retire(childId, 1, context).map(right)
      allowance <-
        sql"SELECT claim_id, generation_id FROM achievement_retired_manual_sources WHERE item_id = $childId"
          .query[(UUID, UUID)].to[List].transact(transactor)
      cancelledDirect <- repo.correctClaim(
        direct.id,
        CorrectAchievementClaim(direct.version, 1, "cancelled", None, None, None),
        context
      ).map(right)
      restored <- repo.correctClaim(
        direct.id,
        CorrectAchievementClaim(
          cancelledDirect.version,
          1,
          "achieved",
          None,
          direct.achievedAt,
          None
        ),
        context
      ).map(right)
      cancelledAgain <- repo.correctClaim(
        direct.id,
        CorrectAchievementClaim(restored.version, 1, "cancelled", None, None, None),
        context
      ).map(right)
      _ <- repo.addToMatch(
        matched.id,
        AddMatchAchievements(
          0,
          List(AddMatchAchievement(parentId, member, 1, Some(cancelledAgain.version)))
        ),
        context
      ).map(right)
      newGeneration <- claims(repo, world).map(_.find(_.id.equals(direct.id)).get)
      frozen <-
        sql"SELECT claim_id, generation_id FROM achievement_retired_manual_sources WHERE item_id = $childId"
          .query[(UUID, UUID)].to[List].transact(transactor)
    yield
      assertEquals(preserved, cancelled)
      assertEquals(retired.retiredAt, Some(now))
      assertEquals(allowance, List(direct.id -> direct.generationId))
      assertEquals(restored.generationId, direct.generationId)
      assert(!newGeneration.generationId.equals(direct.generationId))
      assertEquals(frozen, allowance)

  test("event locks serialize cross-title insertion and deletion refreshes every remaining title"):
    for
      first <- seed
      second <- seed
      original = record(first, 1)
      extra = record(second, 2).copy(heldEventId = first.event)
      _ <- confirmations.confirm(original, None, now).map(right)
      beforeFirst <- revision(first)
      beforeSecond <- revision(second)
      _ <- Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
        val xa = Transactor.fromConnection[IO](connection, None)
        (for
          _ <- IO.blocking(connection.setAutoCommit(false))
          _ <- xa.rawTrans.apply(PostgresAchievementMatchLocks.lockEvents(List(first.event)))
          blocker <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
          _ <- confirmations.confirm(extra, None, now).background.use { completed =>
            for
              _ <- awaitBackendBlockedBy(blocker)
              _ <- IO.blocking(connection.commit())
              result <- completed.flatMap(_.embedNever)
            yield assertEquals(result, Right(MatchConfirmationResult.Confirmed))
          }
        yield ()).guarantee(IO.blocking(connection.rollback()))
      }
      insertedFirst <- revision(first)
      insertedSecond <- revision(second)
      _ <- matches.delete(extra.id, Some(account))
      deletedFirst <- revision(first)
      deletedSecond <- revision(second)
    yield
      assertEquals(insertedFirst, beforeFirst + 1)
      assertEquals(insertedSecond, beforeSecond + 1)
      assertEquals(deletedFirst, insertedFirst + 1)
      assertEquals(deletedSecond, insertedSecond + 1)

  test("map deletion and a new map-specific item cannot deadlock or leave a partial definition"):
    for
      world <- seed
      repo <- repository
      _ <-
        repo.create(definition(world).copy(common = true, mapMasterIds = Nil), context).map(right)
      result <-
        Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
          val xa = Transactor.fromConnection[IO](connection, None)
          (for
            _ <- IO.blocking(connection.setAutoCommit(false))
            _ <- xa.rawTrans.apply(
              sql"SELECT id FROM map_masters WHERE id = ${UUID.fromString(world.map.value)} FOR UPDATE".query[
                UUID
              ].unique
            )
            blocker <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
            result <- repo.create(definition(world), context).background.use { completed =>
              for
                _ <- awaitBackendBlockedBy(blocker)
                _ <- xa.rawTrans.apply(PostgresMapMasters.alg.delete(world.map))
                _ <- IO.blocking(connection.commit())
                value <- completed.flatMap(_.embedNever)
              yield value
            }
          yield result).guarantee(IO.blocking(connection.rollback()))
        }
      catalog <- repo.catalog(world.title).map(right)
    yield
      assert(result.isLeft)
      assertEquals(catalog.items.size, 1)
      assertEquals(catalog.maps, Nil)

  test("automatic imports and claim corrections are rejected while legacy rows remain intact"):
    for
      world <- seed
      repo <- repository
      automaticId = UUID.randomUUID()
      automatic = InitialAchievementItem(
        automaticId,
        "fixture-destination",
        definition(world).copy(rule = AchievementRule.Destination, threshold = Some(BigDecimal(6)))
      )
      initial = AchievementInitialization(
        List(automatic),
        List(InitialAchievementClaim(automaticId, member, "achieved"))
      )
      rejected <- PostgresAchievementInitialization.initialize(initial, context, identitySchema)
        .transact(transactor).attempt
      empty <- repo.catalog(world.title).map(right)
      _ <- PostgresAchievementInitialization.initialize(
        initial.copy(claims = Nil),
        context,
        identitySchema
      )
        .transact(transactor)
      before <- revision(world)
      spoofed <- PostgresAchievementInitialization.initialize(
        initial.copy(items = List(automatic.copy(definition = definition(world)))),
        context,
        identitySchema
      ).transact(transactor).attempt
      noClaims <- claims(repo, world)
      _ <- legacyAutomaticClaim(automaticId)
      imported <- claims(repo, world).map(_.head)
      corrections <- List("achieved", "unconfirmed", "cancelled").traverse(state =>
        repo.correctClaim(
          imported.id,
          CorrectAchievementClaim(imported.version, 1, state, None, None, None),
          context
        )
      )
      _ <- PostgresAchievementInitialization.initialize(
        initial.copy(claims = Nil),
        context,
        identitySchema
      )
        .transact(transactor)
      preserved <- claims(repo, world)
      after <- revision(world)
    yield
      assert(rejected.isLeft)
      assertEquals(empty.items, Nil)
      assert(spoofed.isLeft)
      assertEquals(noClaims, Nil)
      assert(corrections.forall(_.left.exists(isConflict)))
      assertEquals(preserved, List(imported))
      assertEquals(after, before)

  test(
    "automatic retirement uses the current bounded artifact, captures current text and survives artifact cleanup"
  ):
    for
      world <- seed
      repo <- repository
      matched = record(world, 1)
      _ <- confirmations.confirm(matched, None, now).map(right)
      automaticId = UUID.randomUUID()
      manualId = UUID.randomUUID()
      initial = AchievementInitialization(
        List(
          InitialAchievementItem(
            automaticId,
            "fixture-destination",
            definition(world).copy(
              common = true,
              mapMasterIds = Nil,
              rule = AchievementRule.Destination,
              threshold = Some(BigDecimal(6))
            )
          ),
          InitialAchievementItem(
            manualId,
            "fixture-manual",
            definition(world).copy(common = true, mapMasterIds = Nil)
          )
        ),
        Nil
      )
      _ <- PostgresAchievementInitialization.initialize(
        initial,
        context,
        identitySchema
      ).transact(transactor)
      _ <- legacyAutomaticClaim(automaticId)
      unavailable <- repo.retire(automaticId, 1, context)
      artifact <- publishAchievementFixture(world, automaticId, manualId, matched.id)
      analysis <- PostgresSeriesAnalysisRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
        identitySchema
      )
      request = SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Achievements,
        world.title,
        artifact,
        SeriesAnalysisScope.Overall
      )
      hydrated <- analysis.chunk(request).map(right)
      inputBefore <- revision(world)
      renamed <-
        repo.update(automaticId, UpdateAchievement("廃止時の名前", "廃止時の注記", 2, 1), context).map(right)
      inputAfter <- revision(world)
      stale <- repo.retire(automaticId, 1, context)
      retired <- repo.retire(automaticId, renamed.version, context).map(right)
      snapshot <-
        sql"SELECT snapshot::text FROM achievement_retired_snapshots WHERE item_id = $automaticId"
          .query[String].unique.transact(transactor)
      catalog <- repo.catalog(world.title).map(right)
      revisionBeforeOrder <- revision(world)
      _ <- repo.reorder(ReorderAchievements(
        world.title,
        catalog.orderRevision,
        List(manualId, automaticId)
      ))
        .map(right)
      reordered <- analysis.chunk(request).map(right)
      revisionAfterOrder <- revision(world)
      imported <- claims(repo, world).map(_.head)
      correction <- repo.correctClaim(
        imported.id,
        CorrectAchievementClaim(imported.version, retired.version, "achieved", None, None, None),
        context
      )
      _ <- matches.delete(matched.id, Some(account))
      missing <- analysis.chunk(request).map(right)
      _ <-
      (sql"""UPDATE series_analysis_title_states SET current_artifact_id = NULL, previous_artifact_id = NULL
        WHERE game_title_id = ${UUID.fromString(world.title.value)}""".update.run *>
        sql"DELETE FROM series_analysis_artifacts WHERE id = $artifact".update.run).transact(
        transactor
      )
      durable <-
        sql"SELECT snapshot::text FROM achievement_retired_snapshots WHERE item_id = $automaticId"
          .query[String].unique.transact(transactor)
    yield
      assert(unavailable.left.exists(isConflict))
      assert(stale.left.exists(isConflict))
      assertEquals(inputAfter, inputBefore)
      assertEquals(retired.retiredAt, Some(now))
      assert(correction.left.exists(isConflict))
      val saved = parser.parse(snapshot).toOption.get
      assertEquals(saved.hcursor.downField("definition").get[String]("name"), Right("廃止時の名前"))
      assertEquals(saved.hcursor.downField("definition").get[String]("notes"), Right("廃止時の注記"))
      assertEquals(saved.hcursor.get[List[Json]]("players").map(_.size), Right(4))
      def decoded(chunk: SeriesAnalysisChunk): Json =
        parser.parse(new String(chunk.payload, StandardCharsets.UTF_8)).toOption.get
      def proofAvailable(chunk: SeriesAnalysisChunk): Either[io.circe.Error, Boolean] =
        decoded(chunk).hcursor.get[List[Json]]("items").toOption.get
          .find(_.hcursor.get[String]("achievementId").contains(automaticId.toString)).get.hcursor
          .downField(
            "players"
          ).downArray.downField("proofs").downArray.get[Boolean]("matchAvailable")
      assertEquals(proofAvailable(hydrated), Right(true))
      assertEquals(proofAvailable(missing), Right(false))
      assertEquals(
        decoded(reordered).hcursor.get[List[Json]](
          "items"
        ).map(_.map(_.hcursor.get[String]("achievementId").toOption.get)),
        Right(List(manualId.toString, automaticId.toString))
      )
      assertEquals(
        decoded(reordered).hcursor.downField("summaries").focus,
        decoded(hydrated).hcursor.downField("summaries").focus
      )
      assertEquals(revisionAfterOrder, revisionBeforeOrder)
      assertEquals(durable, snapshot)

  private def publishAchievementFixture(
      world: World,
      automatic: UUID,
      manual: UUID,
      matched: MatchId
  ): IO[String] =
    val artifact = UUID.randomUUID()
    val source = Files.readString(
      Paths.get("../../docs/schemas/fixtures/series-analysis/achievements-payload-v2.json")
    )
    val replacements = Map(
      "title" -> world.title.value,
      "destination" -> automatic.toString,
      "manual" -> manual.toString,
      "match-1" -> matched.value,
      "east" -> world.map.value,
      "west" -> fresh
    ) ++
      List("a", "b", "c", "d").zip(memberValues)
    def replace(json: Json): Json = json.arrayOrObject(
      json.asString.fold(json)(value => Json.fromString(replacements.getOrElse(value, value))),
      values => Json.fromValues(values.map(replace)),
      fields => Json.fromJsonObject(fields.mapValues(replace))
    )
    // The strings used as rule names must remain their public enum values.
    val parsed = replace(parser.parse(source).fold(error => fail(error.toString), identity))
    val payloadJson =
      parsed.hcursor.downField("items").focus.flatMap(_.asArray).get.zipWithIndex.map {
        (item, index) =>
          item.mapObject(_.add(
            "ruleKind",
            Json.fromString(if index == 0 then "destination" else "manual")
          ))
      }
    val payload = parsed.mapObject(_.add(
      "items",
      Json.fromValues(payloadJson)
    )).noSpaces.getBytes(StandardCharsets.UTF_8)
    val size = payload.length
    val checksum = "sha256:" + MessageDigest.getInstance("SHA-256").digest(payload).map(byte =>
      f"${byte & 0xff}%02x"
    ).mkString
    def depth(json: Json): Int = json.arrayOrObject(
      1,
      values => 1 + values.map(depth).maxOption.getOrElse(0),
      fields => 1 + fields.values.map(depth).maxOption.getOrElse(0)
    )
    val nesting = parser.parse(new String(payload, StandardCharsets.UTF_8)).fold(
      error => fail(error.toString),
      depth
    )
    for
      input <- revision(world)
      _ <-
      (sql"""INSERT INTO series_analysis_artifacts
        (id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
         source_input_checksum, root_checksum, status, aggregate_chunk_count, review_chunk_count,
         drilldown_chunk_count, match_context_chunk_count, achievement_chunk_count, encoded_bytes, decoded_bytes, scope_keys)
        VALUES (${artifact.toString}, ${world.title.value}, $input, 'series-analysis-v13', 10,
          $checksum, $checksum, 'staging', 1, 0, 0, 0, 1, $size, $size, ARRAY[]::text[])""".update.run *>
        sql"""INSERT INTO series_analysis_achievement_artifacts
          (artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum)
          VALUES (${artifact.toString}, 'overall', 'overall', $payload, $size, $size, 2, $nesting, $checksum)""".update.run *>
        sql"""UPDATE series_analysis_artifacts SET validation_contract_id = ${SeriesAnalysisArtifactContract.ValidationContractId}
          WHERE id = ${artifact.toString}""".update.run *>
        sql"""UPDATE series_analysis_artifacts SET status = 'published', published_at = $now
          WHERE id = ${artifact.toString}""".update.run *>
        sql"""INSERT INTO series_analysis_artifact_identities(id, legacy_id, game_title_id, legacy_game_title_id)
          VALUES ($artifact, ${artifact.toString}, ${UUID.fromString(
            world.title.value
          )}, ${world.title.value})""".update.run *>
        sql"""UPDATE series_analysis_title_states SET current_artifact_id = $artifact, pending_work = false
          WHERE game_title_id = ${UUID.fromString(
            world.title.value
          )}""".update.run).transact(transactor)
    yield artifact.toString

  test(
    "HTTP keeps master edits operator-only, permits another player's declaration and replays before stale checks"
  ):
    httpAppResource("achievement-contract").use { app =>
      for
        world <- seed
        matched = record(world, 1)
        _ <- confirmations.confirm(matched, None, now).map(right)
        createBody = Json.obj(
          "gameTitleId" -> Json.fromString(world.title.value),
          "name" -> Json.fromString("共通の手動実績"),
          "notes" -> Json.fromString("条件"),
          "common" -> Json.True,
          "mapMasterIds" -> Json.arr(),
          "ruleKind" -> Json.fromString("manual"),
          "threshold" -> Json.Null,
          "stars" -> Json.fromInt(2)
        )
        forbidden <- app.run(writePost(
          Uri.unsafeFromString("/api/achievements/items"),
          createBody,
          "account_akane_mami",
          Some(fresh)
        ))
        _ <- forbidden.body.compile.drain
        created <- app.run(writePost(
          Uri.unsafeFromString("/api/achievements/items"),
          createBody,
          Some(fresh)
        ))
          .flatMap(response => response.as[Json].map(body => (response.status, body)))
        itemId = created._2.hcursor.get[String]("achievementId").toOption.get
        key = fresh
        updateBody = Json.obj(
          "name" -> Json.fromString("更新後"),
          "notes" -> Json.fromString("条件"),
          "stars" -> Json.fromInt(2),
          "expectedVersion" -> Json.fromString("1")
        )
        updatePath = Uri.unsafeFromString(s"/api/achievements/items/$itemId")
        updated <- app.run(writeRequest(Method.PUT, updatePath, Some(key)).withEntity(updateBody))
          .flatMap(response => response.as[Json].map(body => (response.status, body)))
        stale <- app.run(writeRequest(Method.PUT, updatePath, Some(fresh)).withEntity(updateBody))
        _ <- stale.body.compile.drain
        declaration = Json.obj(
          "expectedMatchVersion" -> Json.fromString("0"),
          "achievements" -> Json.arr(Json.obj(
            "achievementId" -> Json.fromString(itemId),
            "memberId" -> Json.fromString(member.value),
            "expectedItemVersion" -> Json.fromString("2"),
            "expectedClaimVersion" -> Json.Null
          ))
        )
        added <- app.run(writePost(
          Uri.unsafeFromString(s"/api/matches/${matched.id.value}/achievements"),
          declaration,
          "account_akane_mami",
          Some(fresh)
        ))
        _ <- added.body.compile.drain
        retired <- app.run(writePost(
          Uri.unsafeFromString(s"/api/achievements/items/$itemId/retire"),
          Json.obj("expectedVersion" -> Json.fromString("2")),
          Some(fresh)
        ))
        _ <- retired.body.compile.drain
        replay <- app.run(writeRequest(Method.PUT, updatePath, Some(key)).withEntity(updateBody))
          .flatMap(response => response.as[Json].map(body => (response.status, body)))
        actor <- sql"""SELECT a.legacy_id FROM achievement_claims c
          JOIN momo_login_accounts a ON a.id = c.updated_by_account_id WHERE c.item_id = ${UUID.fromString(
            itemId
          )}"""
          .query[String].unique.transact(transactor)
      yield
        assertEquals(forbidden.status, Status.Forbidden)
        assertEquals(created._1, Status.Ok)
        assertEquals(updated._1, Status.Ok)
        assertEquals(stale.status, Status.Conflict)
        assertEquals(added.status, Status.Ok)
        assertEquals(retired.status, Status.Ok)
        assertEquals(replay, updated)
        assertEquals(actor, "account_akane_mami")
    }

  test(
    "HTTP catalog order enforces operator access, validates the full list and replays saved order"
  ):
    httpAppResource("achievement-order-contract").use { app =>
      for
        world <- seed
        repo <- repository
        first <- repo.create(definition(world).copy(name = "First"), context).map(right)
        second <- repo.create(definition(world).copy(name = "Second"), context).map(right)
        catalog <- app.run(readGet(Uri.unsafeFromString(
          s"/api/achievements/catalog?gameTitleId=${world.title.value}"
        ))).flatMap(_.as[Json])
        token = catalog.hcursor.get[String]("orderRevision").toOption.get
        body = Json.obj(
          "gameTitleId" -> Json.fromString(world.title.value),
          "expectedOrderRevision" -> Json.fromString(token),
          "achievementIds" ->
            Json.arr(Json.fromString(second.id.toString), Json.fromString(first.id.toString))
        )
        path = Uri.unsafeFromString("/api/achievements/catalog/order")
        forbidden <- app.run(writeRequest(
          Method.PUT,
          path,
          "account_akane_mami",
          Some(fresh)
        ).withEntity(body))
        _ <- forbidden.body.compile.drain
        duplicate <- app.run(writeRequest(Method.PUT, path, Some(fresh)).withEntity(
          body.mapObject(_.add(
            "achievementIds",
            Json.arr(Json.fromString(first.id.toString), Json.fromString(first.id.toString))
          ))
        ))
        _ <- duplicate.body.compile.drain
        incomplete <- app.run(writeRequest(Method.PUT, path, Some(fresh)).withEntity(
          body.mapObject(_.add("achievementIds", Json.arr(Json.fromString(first.id.toString))))
        ))
        _ <- incomplete.body.compile.drain
        key = fresh
        saved <- app.run(writeRequest(Method.PUT, path, Some(key)).withEntity(body))
          .flatMap(response => response.as[Json].map(json => response.status -> json))
        stale <- app.run(writeRequest(Method.PUT, path, Some(fresh)).withEntity(body))
        _ <- stale.body.compile.drain
        _ <- repo.create(definition(world).copy(name = "Later"), context).map(right)
        replay <- app.run(writeRequest(Method.PUT, path, Some(key)).withEntity(body))
          .flatMap(response => response.as[Json].map(json => response.status -> json))
      yield
        assertEquals(forbidden.status, Status.Forbidden)
        assertEquals(duplicate.status, Status.UnprocessableContent)
        assertEquals(incomplete.status, Status.Conflict)
        assertEquals(saved._1, Status.Ok)
        assertEquals(stale.status, Status.Conflict)
        assertEquals(
          saved._2.hcursor.get[List[Json]](
            "items"
          ).map(_.map(_.hcursor.get[String]("achievementId").toOption.get)),
          Right(List(second.id.toString, first.id.toString))
        )
        assertEquals(replay, saved)
    }

  test(
    "manual retirement can capture a parent generation while its correction waits for the title lock"
  ):
    for
      world <- seed
      repo <- repository
      parentId = UUID.randomUUID()
      childId = UUID.randomUUID()
      initial = AchievementInitialization(
        List(
          InitialAchievementItem(parentId, "momotetsu2-patrol-four", definition(world)),
          InitialAchievementItem(
            childId,
            "momotetsu2-patrol-dubbing-four",
            definition(world).copy(name = "下位実績")
          )
        ),
        List(InitialAchievementClaim(parentId, member, "achieved"))
      )
      _ <- PostgresAchievementInitialization.initialize(
        initial,
        context,
        identitySchema
      ).transact(transactor)
      parent <- claims(repo, world).map(_.head)
      corrected <-
        Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
          val xa = Transactor.fromConnection[IO](connection, None)
          (for
            _ <- IO.blocking(connection.setAutoCommit(false))
            _ <- xa.rawTrans.apply(PostgresAchievementReadOps.lockItems(List(childId)))
            _ <- xa.rawTrans.apply(PostgresAchievementRetirementOps.state(world.title, lock = true))
            blocker <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
            result <- repo.correctClaim(
              parent.id,
              CorrectAchievementClaim(parent.version, 1, "cancelled", None, None, None),
              context
            ).background.use { completed =>
              for
                _ <- awaitBackendBlockedBy(blocker)
                _ <- xa.rawTrans.apply(PostgresAchievementRetirementOps.retire(
                  childId,
                  1,
                  None,
                  context
                ))
                _ <- IO.blocking(connection.commit())
                value <- completed.flatMap(_.embedNever).map(right)
              yield value
            }
          yield result).guarantee(IO.blocking(connection.rollback()))
        }
      sources <-
        sql"SELECT claim_id, generation_id FROM achievement_retired_manual_sources WHERE item_id = $childId"
          .query[(UUID, UUID)].to[List].transact(transactor)
    yield
      assertEquals(corrected.state, "cancelled")
      assertEquals(sources, List(parent.id -> parent.generationId))
