package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, MemberAlias, SeasonMaster}
import momo.api.errors.AppError

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
      updateTitle <- titles.update(missingTitle)
      deleteTitle <- titles.delete(titleId)
      updateMap <- maps.update(missingMap)
      deleteMap <- maps.delete(mapId)
      updateSeason <- seasons.update(missingSeason)
      deleteSeason <- seasons.delete(seasonId)
      updateAlias <- aliases.update(missingAlias)
      deleteAlias <- aliases.delete(missingAlias.id)
    yield
      assertEquals(updateTitle, Left(AppError.NotFound("game title", titleId.value)))
      assertEquals(deleteTitle, Left(AppError.NotFound("game title", titleId.value)))
      assertEquals(updateMap, Left(AppError.NotFound("map master", mapId.value)))
      assertEquals(deleteMap, Left(AppError.NotFound("map master", mapId.value)))
      assertEquals(updateSeason, Left(AppError.NotFound("season master", seasonId.value)))
      assertEquals(deleteSeason, Left(AppError.NotFound("season master", seasonId.value)))
      assertEquals(updateAlias, Left(AppError.NotFound("member alias", missingAlias.id.value)))
      assertEquals(deleteAlias, Left(AppError.NotFound("member alias", missingAlias.id.value)))

  test("master creates reject duplicate repository identities"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      aliases <- InMemoryMemberAliasesRepository.create[IO]
      _ <- titles.createWithNextDisplayOrder(gameTitle(titleId, "World"))
      duplicateTitle <- titles
        .createWithNextDisplayOrder(gameTitle(GameTitleId.unsafeFromString("title_other"), "World"))
      _ <- maps.createWithNextDisplayOrder(mapMaster(mapId, titleId, "East"))
      duplicateMap <- maps
        .createWithNextDisplayOrder(
          mapMaster(MapMasterId.unsafeFromString("map_other"), titleId, "East")
        )
      _ <- seasons.createWithNextDisplayOrder(seasonMaster(seasonId, titleId, "Spring"))
      duplicateSeason <- seasons
        .createWithNextDisplayOrder(
          seasonMaster(SeasonMasterId.unsafeFromString("season_other"), titleId, "Spring")
        )
      _ <- aliases.create(MemberAlias(aliasId1, memberId, "ポン太社長", now))
      duplicateAlias <- aliases.create(MemberAlias(aliasId2, otherMemberId, "ポン太社長", now))
    yield
      assertEquals(
        duplicateTitle,
        Left(AppError.Conflict("game_title already exists: title_other or World")),
      )
      assertEquals(
        duplicateMap,
        Left(AppError.Conflict("map_master already exists: map_other or East")),
      )
      assertEquals(
        duplicateSeason,
        Left(AppError.Conflict("season_master already exists: season_other or Spring")),
      )
      assertEquals(
        duplicateAlias,
        Left(AppError.Conflict("member alias already exists: ポン太社長")),
      )

  test("master updates reject duplicate repository identities"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      aliases <- InMemoryMemberAliasesRepository.create[IO]
      _ <- titles.createWithNextDisplayOrder(gameTitle(titleId, "World"))
      _ <- titles
        .createWithNextDisplayOrder(gameTitle(GameTitleId.unsafeFromString("title_other"), "Japan"))
      duplicateTitle <- titles
        .update(gameTitle(GameTitleId.unsafeFromString("title_other"), "World"))
      _ <- maps.createWithNextDisplayOrder(mapMaster(mapId, titleId, "East"))
      _ <- maps.createWithNextDisplayOrder(
        mapMaster(MapMasterId.unsafeFromString("map_other"), titleId, "West")
      )
      duplicateMap <- maps
        .update(mapMaster(MapMasterId.unsafeFromString("map_other"), titleId, "East"))
      _ <- seasons.createWithNextDisplayOrder(seasonMaster(seasonId, titleId, "Spring"))
      _ <- seasons
        .createWithNextDisplayOrder(
          seasonMaster(SeasonMasterId.unsafeFromString("season_other"), titleId, "Summer")
        )
      duplicateSeason <- seasons
        .update(seasonMaster(SeasonMasterId.unsafeFromString("season_other"), titleId, "Spring"))
      _ <- aliases.create(MemberAlias(aliasId1, memberId, "ポン太社長", now))
      _ <- aliases.create(MemberAlias(aliasId2, otherMemberId, "おたか社長", now))
      duplicateAlias <- aliases.update(MemberAlias(aliasId2, otherMemberId, "ポン太社長", now))
    yield
      assertEquals(
        duplicateTitle,
        Left(AppError.Conflict("game_title already exists: title_other or World")),
      )
      assertEquals(
        duplicateMap,
        Left(AppError.Conflict("map_master already exists: map_other or East")),
      )
      assertEquals(
        duplicateSeason,
        Left(AppError.Conflict("season_master already exists: season_other or Spring")),
      )
      assertEquals(
        duplicateAlias,
        Left(AppError.Conflict("member alias already exists: ポン太社長")),
      )

  private def gameTitle(id: GameTitleId, name: String): GameTitle =
    GameTitle(id, name, "world", 1, now)

  private def mapMaster(id: MapMasterId, gameTitleId: GameTitleId, name: String): MapMaster =
    MapMaster(id, gameTitleId, name, 1, now)

  private def seasonMaster(
      id: SeasonMasterId,
      gameTitleId: GameTitleId,
      name: String,
  ): SeasonMaster = SeasonMaster(id, gameTitleId, name, 1, now)
