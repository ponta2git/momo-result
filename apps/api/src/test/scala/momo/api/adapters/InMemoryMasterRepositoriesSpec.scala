package momo.api.adapters

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, MemberAlias, SeasonMaster}
import momo.api.errors.AppError
import momo.api.testing.AppErrorAssertions.assertAppException

final class InMemoryMasterRepositoriesSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-15T01:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title_in_memory")
  private val mapId = MapMasterId.unsafeFromString("map_in_memory")
  private val seasonId = SeasonMasterId.unsafeFromString("season_in_memory")
  private val memberId = MemberId.unsafeFromString("member_ponta")
  private val otherMemberId = MemberId.unsafeFromString("member_otaka")
  private val aliasId1 = MemberAliasId.unsafeFromString("alias-1")
  private val aliasId2 = MemberAliasId.unsafeFromString("alias-2")

  test("master writes report NotFound when the target row is missing"):
    val missingTitle = GameTitle(titleId, "World", "world", 1, now)
    val missingMap = MapMaster(mapId, titleId, "East", 1, now)
    val missingSeason = SeasonMaster(seasonId, titleId, "Spring", 1, now)
    val missingAlias =
      MemberAlias(MemberAliasId.unsafeFromString("alias-missing"), memberId, "ポン太社長", now)
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      aliases <- InMemoryMemberAliasesRepository.create[IO]
      updateTitle <- titles.update(missingTitle).attempt
      deleteTitle <- titles.delete(titleId).attempt
      updateMap <- maps.update(missingMap).attempt
      deleteMap <- maps.delete(mapId).attempt
      updateSeason <- seasons.update(missingSeason).attempt
      deleteSeason <- seasons.delete(seasonId).attempt
      updateAlias <- aliases.update(missingAlias).attempt
      deleteAlias <- aliases.delete(missingAlias.id).attempt
    yield
      assertAppException(updateTitle, AppError.NotFound("game title", titleId.value))
      assertAppException(deleteTitle, AppError.NotFound("game title", titleId.value))
      assertAppException(updateMap, AppError.NotFound("map master", mapId.value))
      assertAppException(deleteMap, AppError.NotFound("map master", mapId.value))
      assertAppException(updateSeason, AppError.NotFound("season master", seasonId.value))
      assertAppException(deleteSeason, AppError.NotFound("season master", seasonId.value))
      assertAppException(updateAlias, AppError.NotFound("member alias", missingAlias.id.value))
      assertAppException(deleteAlias, AppError.NotFound("member alias", missingAlias.id.value))

  test("master creates reject duplicate repository identities"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      aliases <- InMemoryMemberAliasesRepository.create[IO]
      _ <- titles.create(gameTitle(titleId, "World"))
      duplicateTitle <- titles
        .create(gameTitle(GameTitleId.unsafeFromString("title_other"), "World")).attempt
      _ <- maps.create(mapMaster(mapId, titleId, "East"))
      duplicateMap <- maps
        .create(mapMaster(MapMasterId.unsafeFromString("map_other"), titleId, "East")).attempt
      _ <- seasons.create(seasonMaster(seasonId, titleId, "Spring"))
      duplicateSeason <- seasons
        .create(seasonMaster(SeasonMasterId.unsafeFromString("season_other"), titleId, "Spring"))
        .attempt
      _ <- aliases.create(MemberAlias(aliasId1, memberId, "ポン太社長", now))
      duplicateAlias <- aliases.create(MemberAlias(aliasId2, otherMemberId, "ポン太社長", now)).attempt
    yield
      assertAppException(
        duplicateTitle,
        AppError.Conflict("game_title already exists: title_other or World"),
      )
      assertAppException(
        duplicateMap,
        AppError.Conflict("map_master already exists: map_other or East"),
      )
      assertAppException(
        duplicateSeason,
        AppError.Conflict("season_master already exists: season_other or Spring"),
      )
      assertAppException(duplicateAlias, AppError.Conflict("member alias already exists: ポン太社長"))

  test("master updates reject duplicate repository identities"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      aliases <- InMemoryMemberAliasesRepository.create[IO]
      _ <- titles.create(gameTitle(titleId, "World"))
      _ <- titles.create(gameTitle(GameTitleId.unsafeFromString("title_other"), "Japan"))
      duplicateTitle <- titles
        .update(gameTitle(GameTitleId.unsafeFromString("title_other"), "World")).attempt
      _ <- maps.create(mapMaster(mapId, titleId, "East"))
      _ <- maps.create(mapMaster(MapMasterId.unsafeFromString("map_other"), titleId, "West"))
      duplicateMap <- maps
        .update(mapMaster(MapMasterId.unsafeFromString("map_other"), titleId, "East")).attempt
      _ <- seasons.create(seasonMaster(seasonId, titleId, "Spring"))
      _ <- seasons
        .create(seasonMaster(SeasonMasterId.unsafeFromString("season_other"), titleId, "Summer"))
      duplicateSeason <- seasons
        .update(seasonMaster(SeasonMasterId.unsafeFromString("season_other"), titleId, "Spring"))
        .attempt
      _ <- aliases.create(MemberAlias(aliasId1, memberId, "ポン太社長", now))
      _ <- aliases.create(MemberAlias(aliasId2, otherMemberId, "おたか社長", now))
      duplicateAlias <- aliases.update(MemberAlias(aliasId2, otherMemberId, "ポン太社長", now)).attempt
    yield
      assertAppException(
        duplicateTitle,
        AppError.Conflict("game_title already exists: title_other or World"),
      )
      assertAppException(
        duplicateMap,
        AppError.Conflict("map_master already exists: map_other or East"),
      )
      assertAppException(
        duplicateSeason,
        AppError.Conflict("season_master already exists: season_other or Spring"),
      )
      assertAppException(duplicateAlias, AppError.Conflict("member alias already exists: ポン太社長"))

  private def gameTitle(id: GameTitleId, name: String): GameTitle =
    GameTitle(id, name, "world", 1, now)

  private def mapMaster(id: MapMasterId, gameTitleId: GameTitleId, name: String): MapMaster =
    MapMaster(id, gameTitleId, name, 1, now)

  private def seasonMaster(
      id: SeasonMasterId,
      gameTitleId: GameTitleId,
      name: String,
  ): SeasonMaster = SeasonMaster(id, gameTitleId, name, 1, now)
