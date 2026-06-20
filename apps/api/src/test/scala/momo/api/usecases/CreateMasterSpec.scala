package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryMapMastersRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.testing.AppErrorAssertions.assertAppError

final class CreateMasterSpec extends MomoCatsEffectSuite:
  private val now = IO.pure(Instant.parse("2026-05-06T00:00:00Z"))

  test("CreateGameTitle trims fields and assigns the next display order"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      usecase = CreateGameTitle[IO](titles, now)
      first <- usecase.run(
        CreateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), " World ", " world ")
      )
      second <- usecase
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_japan"), "Japan", "japan"))
    yield
      assertEquals(first.map(_.name), Right("World"))
      assertEquals(first.map(_.layoutFamily), Right("world"))
      assertEquals(first.map(_.displayOrder), Right(1))
      assertEquals(second.map(_.displayOrder), Right(2))

  test("CreateGameTitle rejects invalid IDs and duplicate IDs"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      usecase = CreateGameTitle[IO](titles, now)
      invalid <- usecase
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("Title-World"), "World", "world"))
      _ <- usecase
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), "World", "world"))
      duplicate <- usecase
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), "World", "world"))
    yield
      assertAppError(invalid, "VALIDATION_FAILED", "id must match")
      assertAppError(duplicate, "CONFLICT", "already exists")

  test("game title create and update reject invalid layout family keys"):
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

  test("CreateMapMaster requires an existing game title and assigns display order per title"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      createTitle = CreateGameTitle[IO](titles, now)
      usecase = CreateMapMaster[IO](titles, maps, now)
      missing <- usecase.run(CreateMapMasterCommand(
        MapMasterId.unsafeFromString("map_east"),
        GameTitleId.unsafeFromString("missing_title"),
        "East",
      ))
      _ <- createTitle
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), "World", "world"))
      _ <- createTitle
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_japan"), "Japan", "japan"))
      east <- usecase.run(CreateMapMasterCommand(
        MapMasterId.unsafeFromString("map_east"),
        GameTitleId.unsafeFromString("title_world"),
        "East",
      ))
      west <- usecase.run(CreateMapMasterCommand(
        MapMasterId.unsafeFromString("map_west"),
        GameTitleId.unsafeFromString("title_world"),
        "West",
      ))
      japan <- usecase.run(CreateMapMasterCommand(
        MapMasterId.unsafeFromString("map_japan"),
        GameTitleId.unsafeFromString("title_japan"),
        "Japan",
      ))
    yield
      assertAppError(missing, "NOT_FOUND", "game_title was not found")
      assertEquals(east.map(_.displayOrder), Right(1))
      assertEquals(west.map(_.displayOrder), Right(2))
      assertEquals(japan.map(_.displayOrder), Right(1))

  test("CreateSeasonMaster requires an existing game title and rejects duplicate IDs"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      seasons <- InMemorySeasonMastersRepository.create[IO]
      createTitle = CreateGameTitle[IO](titles, now)
      usecase = CreateSeasonMaster[IO](titles, seasons, now)
      missing <- usecase.run(CreateSeasonMasterCommand(
        SeasonMasterId.unsafeFromString("season_spring"),
        GameTitleId.unsafeFromString("missing"),
        "Spring",
      ))
      _ <- createTitle
        .run(CreateGameTitleCommand(GameTitleId.unsafeFromString("title_world"), "World", "world"))
      _ <- usecase.run(CreateSeasonMasterCommand(
        SeasonMasterId.unsafeFromString("season_spring"),
        GameTitleId.unsafeFromString("title_world"),
        "Spring",
      ))
      duplicate <- usecase.run(CreateSeasonMasterCommand(
        SeasonMasterId.unsafeFromString("season_spring"),
        GameTitleId.unsafeFromString("title_world"),
        "Spring",
      ))
    yield
      assertAppError(missing, "NOT_FOUND", "game_title was not found")
      assertAppError(duplicate, "CONFLICT", "already exists")
