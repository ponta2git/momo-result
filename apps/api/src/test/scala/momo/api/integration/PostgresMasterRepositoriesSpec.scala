package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.postgres.*
import momo.api.usecases.*

final class PostgresMasterRepositoriesSpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-01T00:00:00Z")
  private val titleId = GameTitleId("title_test")
  private val mapId = MapMasterId("map_test")
  private val seasonId = SeasonMasterId("season_test")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def memberAliases = new PostgresMemberAliasesRepository[IO](transactor)
  private def members = new PostgresMembersRepository[IO](transactor)

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

  test("member aliases create, list, update, reject duplicates, and delete"):
    val create =
      new CreateMemberAlias[IO](memberAliases, members, IO.pure(now), IO.pure("alias-ponta"))
    val createDuplicateId =
      new CreateMemberAlias[IO](memberAliases, members, IO.pure(now), IO.pure("alias-otaka"))
    val update = new UpdateMemberAlias[IO](memberAliases, members)
    val delete = new DeleteMemberAlias[IO](memberAliases)
    for
      created <- create.run(CreateMemberAliasCommand("member_ponta", "  ポン太社長  "))
      duplicate <- createDuplicateId.run(CreateMemberAliasCommand("member_otaka", "ポン太社長"))
      list <- memberAliases.list(Some(MemberId("member_ponta")))
      updated <- update.run(UpdateMemberAliasCommand("alias-ponta", "member_otaka", "おたか社長"))
      found <- memberAliases.find("alias-ponta")
      deleted <- delete.run("alias-ponta")
      afterDelete <- memberAliases.find("alias-ponta")
    yield
      assertEquals(created.map(_.alias), Right("ポン太社長"))
      assertEquals(duplicate, Left(AppError.Conflict("member alias already exists: ポン太社長")))
      assertEquals(list.map(_.id), List("alias-ponta"))
      assertEquals(updated.map(_.memberId), Right(MemberId("member_otaka")))
      assertEquals(found.map(_.alias), Some("おたか社長"))
      assertEquals(deleted, Right(()))
      assertEquals(afterDelete, None)
end PostgresMasterRepositoriesSpec
