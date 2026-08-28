package momo.api.usecases.common

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.{
  InMemoryGameTitlesRepository,
  InMemoryHeldEventsRepository,
  InMemoryMapMastersRepository,
  InMemorySeasonMastersRepository
}
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, HeldEvent, MapMaster, SeasonMaster}
import momo.api.errors.AppError

final class MatchReferenceValidationSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-08-28T00:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held-reference-validation")
  private val titleId = GameTitleId.unsafeFromString("title-reference-a")
  private val otherTitleId = GameTitleId.unsafeFromString("title-reference-b")
  private val mapId = MapMasterId.unsafeFromString("map-reference-a")
  private val otherSeasonId = SeasonMasterId.unsafeFromString("season-reference-b")

  test("required references report a season-to-title mismatch after the map passes"):
    for
      fixture <- Fixture.create
      _ <- fixture.seed
      result <- fixture.validation
        .validateRequired(heldEventId, titleId, mapId, otherSeasonId).value
    yield assertEquals(
      result,
      Left(AppError.ValidationFailed(
        "seasonMasterId season-reference-b does not belong to gameTitleId title-reference-a."
      )),
    )

  test("optional references validate a season's existence without inventing a title relation"):
    for
      fixture <- Fixture.create
      _ <- fixture.seed
      result <- fixture.validation.validateOptional(MatchReferenceValidation.Input(
        heldEventId = None,
        gameTitleId = None,
        mapMasterId = None,
        seasonMasterId = Some(otherSeasonId),
      )).value
    yield assertEquals(result, Right(()))

  test("reference failures retain held-event-first ordering"):
    for
      fixture <- Fixture.create
      result <- fixture.validation.validateOptional(MatchReferenceValidation.Input(
        heldEventId = Some(heldEventId),
        gameTitleId = Some(titleId),
        mapMasterId = Some(mapId),
        seasonMasterId = Some(otherSeasonId),
      )).value
    yield assertEquals(result, Left(AppError.NotFound("held event", heldEventId.value)))

  private final case class Fixture(
      heldEvents: InMemoryHeldEventsRepository[IO],
      gameTitles: InMemoryGameTitlesRepository[IO],
      mapMasters: InMemoryMapMastersRepository[IO],
      seasonMasters: InMemorySeasonMastersRepository[IO],
  ):
    val validation = MatchReferenceValidation[IO](
      heldEvents,
      gameTitles,
      mapMasters,
      seasonMasters,
    )

    def seed: IO[Unit] =
      for
        _ <- heldEvents.create(HeldEvent(heldEventId, now))
        _ <- gameTitles.createWithNextDisplayOrder(GameTitle(titleId, "A", "a", 0, now))
        _ <- gameTitles.createWithNextDisplayOrder(GameTitle(otherTitleId, "B", "b", 0, now))
        _ <- mapMasters.createWithNextDisplayOrder(MapMaster(mapId, titleId, "Map A", 0, now))
        _ <- seasonMasters
          .createWithNextDisplayOrder(SeasonMaster(otherSeasonId, otherTitleId, "Season B", 0, now))
      yield ()

  private object Fixture:
    def create: IO[Fixture] =
      for
        heldEvents <- InMemoryHeldEventsRepository.create[IO]
        gameTitles <- InMemoryGameTitlesRepository.create[IO]
        mapMasters <- InMemoryMapMastersRepository.create[IO]
        seasonMasters <- InMemorySeasonMastersRepository.create[IO]
      yield Fixture(heldEvents, gameTitles, mapMasters, seasonMasters)
end MatchReferenceValidationSpec
