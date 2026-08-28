package momo.api.usecases.masters

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.{InMemoryGameTitlesRepository, InMemoryMapMastersRepository}
import momo.api.domain.ids.{GameTitleId, MapMasterId}
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

end CreateMasterSpec
