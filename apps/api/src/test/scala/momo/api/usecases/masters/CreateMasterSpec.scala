package momo.api.usecases.masters

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.{
  InMemoryGameTitlesRepository,
  InMemoryMapMastersRepository,
  InMemorySeasonMastersRepository
}
import momo.api.domain.constraints.TextLimits
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.testing.AppErrorAssertions.assertAppError

final class CreateMasterSpec extends MomoCatsEffectSuite:
  private val now = IO.pure(Instant.parse("2026-05-06T00:00:00Z"))

  test("game title create and update reject invalid layout-family keys"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      create = CreateGameTitle[IO](titles, now)
      update = UpdateGameTitle[IO](titles)
      invalidCreate <- create
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_invalid"), "Invalid", "2"))
      _ <- create
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), "World", "world"))
      invalidUpdate <- update.run(
        UpdateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), "World", "World DX")
      )
    yield
      assertAppError(invalidCreate, "VALIDATION_FAILED", "layoutFamily must match")
      assertAppError(invalidUpdate, "VALIDATION_FAILED", "layoutFamily must match")

  test("map creation requires an existing game title"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      result <- CreateMapMaster[IO](titles, maps, now).run(CreateMapMasterCommand(
        MapMasterId.unsafeFromString("map_east"),
        GameTitleId.unsafeFromString("missing_title"),
        "East",
      ))
    yield assertAppError(result, "NOT_FOUND", "game_title was not found")

  test(
    "master names bound every create and update while preserving Unicode names and stored values"
  ):
    val titleId = GameTitleId.unsafeFromString("title_names")
    val mapId = MapMasterId.unsafeFromString("map_names")
    val seasonId = SeasonMasterId.unsafeFromString("season_names")
    val boundary = "🍑" * TextLimits.NameMaxCodePoints
    val tooLong = boundary + "x"
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      createdTitle <- CreateGameTitle[IO](
        titles,
        now
      ).run(CreateGameTitleCommand(titleId, s" $boundary ", "world"))
      _ <- CreateMapMaster[IO](titles, maps, now).run(CreateMapMasterCommand(mapId, titleId, "Map"))
      _ <- CreateSeasonMaster[IO](
        titles,
        seasons,
        now
      ).run(CreateSeasonMasterCommand(seasonId, titleId, "Season"))
      rejected <- List(
        CreateGameTitle[IO](titles, now).run(CreateGameTitleCommand(
          GameTitleId.unsafeFromString("title_long"),
          tooLong,
          "world"
        )).map(_.map(_.name)),
        CreateMapMaster[IO](titles, maps, now).run(CreateMapMasterCommand(
          MapMasterId.unsafeFromString("map_long"),
          titleId,
          tooLong
        )).map(_.map(_.name)),
        CreateSeasonMaster[IO](titles, seasons, now).run(CreateSeasonMasterCommand(
          SeasonMasterId.unsafeFromString("season_long"),
          titleId,
          tooLong
        )).map(_.map(_.name)),
        UpdateGameTitle[IO](titles).run(UpdateGameTitleCommand(
          titleId,
          tooLong,
          "world"
        )).map(_.map(_.name)),
        UpdateMapMaster[IO](maps).run(UpdateMapMasterCommand(mapId, tooLong)).map(_.map(_.name)),
        UpdateSeasonMaster[IO](seasons).run(UpdateSeasonMasterCommand(
          seasonId,
          tooLong
        )).map(_.map(_.name)),
      ).sequence
      savedTitles <- titles.list
      savedMaps <- maps.list(None)
      savedSeasons <- seasons.list(None)
    yield
      assertEquals(createdTitle.map(_.name), Right(boundary))
      rejected.foreach(assertAppError(_, "VALIDATION_FAILED", "at most 256"))
      assertEquals(savedTitles.map(_.name), List(boundary))
      assertEquals(savedMaps.map(_.name), List("Map"))
      assertEquals(savedSeasons.map(_.name), List("Season"))

end CreateMasterSpec
