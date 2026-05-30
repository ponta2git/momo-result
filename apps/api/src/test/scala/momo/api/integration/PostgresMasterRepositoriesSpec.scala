package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.postgres.*
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.usecases.*

final class PostgresMasterRepositoriesSpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-01T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title_test")
  private val mapId = MapMasterId.unsafeFromString("map_test")
  private val seasonId = SeasonMasterId.unsafeFromString("season_test")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def memberAliases = new PostgresMemberAliasesRepository[IO](transactor)
  private def members = new PostgresMembersRepository[IO](transactor)
  private def matchDrafts = new PostgresMatchDraftsRepository[IO](transactor)

  private def seedTitle: IO[Unit] = gameTitles
    .create(GameTitle(titleId, "テストタイトル", "world", 1, now))

  private def seedScopedMasters: IO[Unit] =
    for
      _ <- seedTitle
      _ <- mapMasters.create(MapMaster(mapId, titleId, "テストマップ", 1, now))
      _ <- seasonMasters.create(SeasonMaster(seasonId, titleId, "テスト期間", 1, now))
    yield ()

  test("game titles update and delete unused rows"):
    val update = new UpdateGameTitle[IO](gameTitles)
    val delete = new DeleteGameTitle[IO](gameTitles)
    for
      _ <- seedTitle
      updated <- update.run(UpdateGameTitleCommand(titleId, "更新済み", "2"))
      foundAfterUpdate <- gameTitles.find(titleId)
      deleted <- delete.run(titleId)
      foundAfterDelete <- gameTitles.find(titleId)
    yield
      assertEquals(updated.map(_.name), Right("更新済み"))
      assertEquals(foundAfterUpdate.map(_.layoutFamily), Some("2"))
      assertEquals(deleted, Right(()))
      assertEquals(foundAfterDelete, None)

  test("map and season masters update and delete unused rows"):
    val updateMap = new UpdateMapMaster[IO](mapMasters)
    val deleteMap = new DeleteMapMaster[IO](mapMasters)
    val updateSeason = new UpdateSeasonMaster[IO](seasonMasters)
    val deleteSeason = new DeleteSeasonMaster[IO](seasonMasters)
    for
      _ <- seedScopedMasters
      updatedMap <- updateMap.run(UpdateMapMasterCommand(mapId, "更新マップ"))
      updatedSeason <- updateSeason.run(UpdateSeasonMasterCommand(seasonId, "更新期間"))
      deletedMap <- deleteMap.run(mapId)
      deletedSeason <- deleteSeason.run(seasonId)
      maps <- mapMasters.list(Some(titleId))
      seasons <- seasonMasters.list(Some(titleId))
    yield
      assertEquals(updatedMap.map(_.name), Right("更新マップ"))
      assertEquals(updatedSeason.map(_.name), Right("更新期間"))
      assertEquals(deletedMap, Right(()))
      assertEquals(deletedSeason, Right(()))
      assertEquals(maps, Nil)
      assertEquals(seasons, Nil)

  test("delete title reports conflict when scoped masters still reference it"):
    val delete = new DeleteGameTitle[IO](gameTitles)
    for
      _ <- seedScopedMasters
      result <- delete.run(titleId)
    yield assertEquals(result, Left(AppError.Conflict("game title is still referenced.")))

  test("discarded match drafts no longer block scoped master deletion"):
    val draftId = MatchDraftId.unsafeFromString("draft_master_delete")
    val deleteTitle = new DeleteGameTitle[IO](gameTitles)
    val deleteMap = new DeleteMapMaster[IO](mapMasters)
    val deleteSeason = new DeleteSeasonMaster[IO](seasonMasters)
    for
      _ <- seedScopedMasters
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status,
          game_title_id, layout_family, season_master_id, map_master_id,
          created_at, updated_at
        ) VALUES (
          $draftId, 'account_ponta', 'member_ponta', 'needs_review',
          $titleId, 'world', $seasonId, $mapId,
          $now, $now
        )
      """.update.run.transact(transactor)
      blocked <- deleteMap.run(mapId)
      cancelled <- matchDrafts.cancel(draftId, now.plusSeconds(1))
      deletedMap <- deleteMap.run(mapId)
      deletedSeason <- deleteSeason.run(seasonId)
      deletedTitle <- deleteTitle.run(titleId)
    yield
      assertEquals(blocked, Left(AppError.Conflict("map master is still referenced.")))
      assertEquals(cancelled, true)
      assertEquals(deletedMap, Right(()))
      assertEquals(deletedSeason, Right(()))
      assertEquals(deletedTitle, Right(()))

  test("legacy cancelled drafts are cleaned up before scoped master deletion"):
    val deleteTitle = new DeleteGameTitle[IO](gameTitles)
    val deleteMap = new DeleteMapMaster[IO](mapMasters)
    val deleteSeason = new DeleteSeasonMaster[IO](seasonMasters)
    for
      _ <- seedScopedMasters
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status,
          game_title_id, layout_family, season_master_id, map_master_id,
          created_at, updated_at
        ) VALUES (
          'draft_master_delete_legacy', 'account_ponta', 'member_ponta', 'cancelled',
          $titleId, 'world', $seasonId, $mapId,
          $now, $now
        )
      """.update.run.transact(transactor)
      deletedMap <- deleteMap.run(mapId)
      deletedSeason <- deleteSeason.run(seasonId)
      deletedTitle <- deleteTitle.run(titleId)
      legacyExists <- sql"""
        SELECT EXISTS(SELECT 1 FROM match_drafts WHERE id = 'draft_master_delete_legacy')
      """.query[Boolean].unique.transact(transactor)
    yield
      assertEquals(deletedMap, Right(()))
      assertEquals(deletedSeason, Right(()))
      assertEquals(deletedTitle, Right(()))
      assertEquals(legacyExists, false)

  test("master row writes report NotFound when the target row disappeared"):
    val missingTitle =
      GameTitle(GameTitleId.unsafeFromString("title_missing"), "missing", "world", 1, now)
    val missingMap =
      MapMaster(MapMasterId.unsafeFromString("map_missing"), titleId, "missing", 1, now)
    val missingSeason =
      SeasonMaster(SeasonMasterId.unsafeFromString("season_missing"), titleId, "missing", 1, now)
    val missingAlias = MemberAlias(
      id = MemberAliasId.unsafeFromString("alias-missing"),
      memberId = MemberId.unsafeFromString("member_ponta"),
      alias = "missing",
      createdAt = now,
    )
    for
      updateTitle <- gameTitles.update(missingTitle).attempt
      deleteTitle <- gameTitles.delete(missingTitle.id).attempt
      updateMap <- mapMasters.update(missingMap).attempt
      deleteMap <- mapMasters.delete(missingMap.id).attempt
      updateSeason <- seasonMasters.update(missingSeason).attempt
      deleteSeason <- seasonMasters.delete(missingSeason.id).attempt
      updateAlias <- memberAliases.update(missingAlias).attempt
      deleteAlias <- memberAliases.delete(missingAlias.id).attempt
    yield
      assertAppError(updateTitle, AppError.NotFound("game title", missingTitle.id.value))
      assertAppError(deleteTitle, AppError.NotFound("game title", missingTitle.id.value))
      assertAppError(updateMap, AppError.NotFound("map master", missingMap.id.value))
      assertAppError(deleteMap, AppError.NotFound("map master", missingMap.id.value))
      assertAppError(updateSeason, AppError.NotFound("season master", missingSeason.id.value))
      assertAppError(deleteSeason, AppError.NotFound("season master", missingSeason.id.value))
      assertAppError(updateAlias, AppError.NotFound("member alias", missingAlias.id.value))
      assertAppError(deleteAlias, AppError.NotFound("member alias", missingAlias.id.value))

  test("member aliases create, list, update, reject duplicates, and delete"):
    val create = new CreateMemberAlias[IO](
      memberAliases,
      members,
      IO.pure(now),
      IO.pure(MemberAliasId.unsafeFromString("alias-ponta")),
    )
    val createDuplicateId = new CreateMemberAlias[IO](
      memberAliases,
      members,
      IO.pure(now),
      IO.pure(MemberAliasId.unsafeFromString("alias-otaka")),
    )
    val update = new UpdateMemberAlias[IO](memberAliases, members)
    val delete = new DeleteMemberAlias[IO](memberAliases)
    for
      created <- create
        .run(CreateMemberAliasCommand(MemberId.unsafeFromString("member_ponta"), "  ポン太社長  "))
      duplicate <- createDuplicateId
        .run(CreateMemberAliasCommand(MemberId.unsafeFromString("member_otaka"), "ポン太社長"))
      list <- memberAliases.list(Some(MemberId.unsafeFromString("member_ponta")))
      updated <- update.run(UpdateMemberAliasCommand(
        MemberAliasId.unsafeFromString("alias-ponta"),
        MemberId.unsafeFromString("member_otaka"),
        "おたか社長",
      ))
      found <- memberAliases.find(MemberAliasId.unsafeFromString("alias-ponta"))
      deleted <- delete.run(MemberAliasId.unsafeFromString("alias-ponta"))
      afterDelete <- memberAliases.find(MemberAliasId.unsafeFromString("alias-ponta"))
    yield
      assertEquals(created.map(_.alias), Right("ポン太社長"))
      assertEquals(duplicate, Left(AppError.Conflict("member alias already exists: ポン太社長")))
      assertEquals(list.map(_.id.value), List("alias-ponta"))
      assertEquals(updated.map(_.memberId), Right(MemberId.unsafeFromString("member_otaka")))
      assertEquals(found.map(_.alias), Some("おたか社長"))
      assertEquals(deleted, Right(()))
      assertEquals(afterDelete, None)

  private def assertAppError[A](result: Either[Throwable, A], expected: AppError): Unit =
    result match
      case Left(error: AppException) => assertEquals(error.error, expected)
      case other => fail(s"expected AppException($expected), got $other")
end PostgresMasterRepositoriesSpec
