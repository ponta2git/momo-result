package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryMapMastersRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.errors.AppError

final class CreateMasterSpec extends MomoCatsEffectSuite:
  private val now = IO.pure(Instant.parse("2026-05-06T00:00:00Z"))

  test("CreateGameTitle trims fields and assigns the next display order"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      usecase = CreateGameTitle[IO](titles, now)
      first <- usecase.run(CreateGameTitleCommand(GameTitleId("title_world"), " World ", " world "))
      second <- usecase.run(CreateGameTitleCommand(GameTitleId("title_japan"), "Japan", "japan"))
    yield
      assertEquals(first.map(_.name), Right("World"))
      assertEquals(first.map(_.layoutFamily), Right("world"))
      assertEquals(first.map(_.displayOrder), Right(1))
      assertEquals(second.map(_.displayOrder), Right(2))

  test("CreateGameTitle rejects invalid IDs and duplicate IDs"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      usecase = CreateGameTitle[IO](titles, now)
      invalid <- usecase.run(CreateGameTitleCommand(GameTitleId("Title-World"), "World", "world"))
      _ <- usecase.run(CreateGameTitleCommand(GameTitleId("title_world"), "World", "world"))
      duplicate <- usecase.run(CreateGameTitleCommand(GameTitleId("title_world"), "World", "world"))
    yield
      assertAppError(invalid, "VALIDATION_FAILED", "id must match")
      assertAppError(duplicate, "CONFLICT", "already exists")

  test("CreateMapMaster requires an existing game title and assigns display order per title"):
    for
      titles <- InMemoryGameTitlesRepository.create[IO]
      maps <- InMemoryMapMastersRepository.create[IO]
      createTitle = CreateGameTitle[IO](titles, now)
      usecase = CreateMapMaster[IO](titles, maps, now)
      missing <- usecase
        .run(CreateMapMasterCommand(MapMasterId("map_east"), GameTitleId("missing_title"), "East"))
      _ <- createTitle.run(CreateGameTitleCommand(GameTitleId("title_world"), "World", "world"))
      _ <- createTitle.run(CreateGameTitleCommand(GameTitleId("title_japan"), "Japan", "japan"))
      east <- usecase
        .run(CreateMapMasterCommand(MapMasterId("map_east"), GameTitleId("title_world"), "East"))
      west <- usecase
        .run(CreateMapMasterCommand(MapMasterId("map_west"), GameTitleId("title_world"), "West"))
      japan <- usecase
        .run(CreateMapMasterCommand(MapMasterId("map_japan"), GameTitleId("title_japan"), "Japan"))
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
      missing <- usecase.run(
        CreateSeasonMasterCommand(SeasonMasterId("season_spring"), GameTitleId("missing"), "Spring")
      )
      _ <- createTitle.run(CreateGameTitleCommand(GameTitleId("title_world"), "World", "world"))
      _ <- usecase.run(CreateSeasonMasterCommand(
        SeasonMasterId("season_spring"),
        GameTitleId("title_world"),
        "Spring",
      ))
      duplicate <- usecase.run(CreateSeasonMasterCommand(
        SeasonMasterId("season_spring"),
        GameTitleId("title_world"),
        "Spring",
      ))
    yield
      assertAppError(missing, "NOT_FOUND", "game_title was not found")
      assertAppError(duplicate, "CONFLICT", "already exists")

  private def assertAppError[A](
      result: Either[AppError, A],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
    case Left(error) =>
      assertEquals(error.code, expectedCode)
      assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
    case Right(value) => fail(s"expected $expectedCode, got success: $value")
