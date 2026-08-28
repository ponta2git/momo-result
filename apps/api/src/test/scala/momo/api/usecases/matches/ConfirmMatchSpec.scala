package momo.api.usecases.matches

import java.time.Instant

import cats.effect.{IO, Resource}
import fs2.Stream

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.{
  InMemoryGameTitlesRepository,
  InMemoryHeldEventsRepository,
  InMemoryMapMastersRepository,
  InMemoryMatchConfirmationRepository,
  InMemoryMatchDraftsRepository,
  InMemoryMatchesRepository,
  InMemorySeasonMastersRepository
}
import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MatchRecord, PlayerResult, StoredImage}
import momo.api.errors.AppError
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.{
  MatchConfirmationRepository,
  MatchConfirmationResult,
  MatchDraftConfirmation
}
import momo.api.testing.AppErrorAssertions.assertAppError
import momo.api.usecases.matchdrafts.PurgeSourceImages
import momo.api.usecases.testing.MatchFixtures

final class ConfirmMatchSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-06T00:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held_2026_05_06")
  private val titleId = GameTitleId.unsafeFromString("title_world")
  private val mapId = MapMasterId.unsafeFromString("map_east")
  private val seasonId = SeasonMasterId.unsafeFromString("season_spring")
  private val playedAt = Instant.parse("2026-05-06T20:00:00Z")
  private val memberValues = MatchFixtures.DevMemberValues
  private val allowedMembers = MatchFixtures.allowedMembers(memberValues)

  test("persists an image-free manual match while object storage is unavailable"):
    Fixture.resource.use { fixture =>
      val manualUsecase = fixture.usecaseWithRetention(
        PurgeSourceImages[IO](fixture.matchDrafts, UnavailableImageStorage),
        IO.pure(MatchId.unsafeFromString("manual-with-storage-down")),
      )
      for
        _ <- fixture.seedPrereqs()
        result <- manualUsecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
        found <- fixture.matches.find(MatchId.unsafeFromString("manual-with-storage-down"))
      yield
        assertEquals(result.map(_.id), Right(MatchId.unsafeFromString("manual-with-storage-down")))
        assertEquals(found.map(_.matchNoInEvent.value), Some(1))
    }

  test("rejects missing held event"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedMastersOnly()
        result <- fixture.usecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield assertAppError(result, "NOT_FOUND", "held event was not found")
    }

  test("rejects duplicate match number for the same held event"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedPrereqs()
        first <- fixture.usecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
        second <- fixture.usecase.run(
          commandWithMatchNo(1),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield
        assertEquals(first.map(_.matchNoInEvent.value), Right(1))
        assertAppError(second, "CONFLICT", "already exists for held event")
    }

  test("maps confirmation repository conflicts into the usecase error channel"):
    Fixture.resource.use { fixture =>
      val usecase = fixture.usecaseWith(
        ConfirmationConflictRepository,
        IO.pure(MatchId.unsafeFromString("match-confirm-conflict")),
      )
      for
        _ <- fixture.seedPrereqs()
        result <- usecase.run(
          command(),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield assertAppError(result, "CONFLICT", "confirmation conflict")
    }

  test("rejects map and season that belong to a different game title"):
    Fixture.resource.use { fixture =>
      for
        _ <- fixture.seedPrereqs()
        _ <- fixture.gameTitles
          .createWithNextDisplayOrder(
            GameTitle(GameTitleId.unsafeFromString("title_japan"), "Japan", "japan", 2, now)
          )
        result <- fixture.usecase.run(
          commandWithGameTitle(GameTitleId.unsafeFromString("title_japan")),
          AccountId.unsafeFromString("ponta"),
          Some(MemberId.unsafeFromString("ponta")),
        )
      yield assertAppError(result, "VALIDATION_FAILED", "mapMasterId")
    }

  private def command(): ConfirmMatchCommand =
    commandWith(matchNoInEvent = 1, gameTitleId = titleId, players = defaultPlayers)

  private def commandWithMatchNo(matchNoInEvent: Int): ConfirmMatchCommand =
    commandWith(matchNoInEvent = matchNoInEvent, gameTitleId = titleId, players = defaultPlayers)

  private def commandWithGameTitle(gameTitleId: GameTitleId): ConfirmMatchCommand =
    commandWith(matchNoInEvent = 1, gameTitleId = gameTitleId, players = defaultPlayers)

  private def commandWith(
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      players: List[PlayerResult.Input],
  ): ConfirmMatchCommand = ConfirmMatchCommand(
    heldEventId = heldEventId,
    matchNoInEvent = matchNoInEvent,
    gameTitleId = gameTitleId,
    seasonMasterId = seasonId,
    ownerMemberId = MemberId.unsafeFromString("ponta"),
    mapMasterId = mapId,
    playedAt = playedAt,
    matchDraftId = None,
    draftRefs = MatchDraftRefs(None, None, None),
    players = players,
  )

  private def defaultPlayers: List[PlayerResult.Input] = MatchFixtures
    .defaultPlayerInputs(memberValues)

  private final case class Fixture(
      gameTitles: InMemoryGameTitlesRepository[IO],
      mapMasters: InMemoryMapMastersRepository[IO],
      seasonMasters: InMemorySeasonMastersRepository[IO],
      heldEvents: InMemoryHeldEventsRepository[IO],
      matches: InMemoryMatchesRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      retention: PurgeSourceImages[IO],
      usecase: ConfirmMatch[IO],
  ):
    def seedPrereqs(): IO[Unit] = MatchFixtures.seedWorldPrereqs(
      heldEvents,
      gameTitles,
      mapMasters,
      seasonMasters,
      heldEventId,
      titleId,
      mapId,
      seasonId,
      now,
    )

    def seedMastersOnly(): IO[Unit] = MatchFixtures
      .seedWorldMasters(gameTitles, mapMasters, seasonMasters, titleId, mapId, seasonId, now)

    def usecaseWith(
        confirmations: MatchConfirmationRepository[IO],
        nextId: IO[MatchId],
    ): ConfirmMatch[IO] = buildUsecase(confirmations, retention, nextId)

    def usecaseWithRetention(
        customRetention: PurgeSourceImages[IO],
        nextId: IO[MatchId],
    ): ConfirmMatch[IO] = buildUsecase(
      InMemoryMatchConfirmationRepository[IO](matches, matches.create, matchDrafts),
      customRetention,
      nextId,
    )

    private def buildUsecase(
        confirmations: MatchConfirmationRepository[IO],
        customRetention: PurgeSourceImages[IO],
        nextId: IO[MatchId],
    ): ConfirmMatch[IO] = ConfirmMatch[IO](
      heldEvents = heldEvents,
      matches = matches,
      matchDrafts = matchDrafts,
      confirmations = confirmations,
      sourceImageRetention = customRetention,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = IO.pure(now),
      nextId = nextId,
      allowedMemberIds = IO.pure(allowedMembers),
    )

  private object Fixture:
    def resource: Resource[IO, Fixture] = tempDirectory("momo-api-confirm-match").evalMap { dir =>
      for
        gameTitles <- InMemoryGameTitlesRepository.create[IO]
        mapMasters <- InMemoryMapMastersRepository.create[IO]
        seasonMasters <- InMemorySeasonMastersRepository.create[IO]
        heldEvents <- InMemoryHeldEventsRepository.create[IO]
        matches <- InMemoryMatchesRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        retention = PurgeSourceImages[IO](matchDrafts, LocalFsImageStore[IO](dir))
        confirmations =
          InMemoryMatchConfirmationRepository[IO](matches, matches.create, matchDrafts)
        ids <- IO.ref(List("match-1", "match-2"))
        usecase = ConfirmMatch[IO](
          heldEvents = heldEvents,
          matches = matches,
          matchDrafts = matchDrafts,
          confirmations = confirmations,
          sourceImageRetention = retention,
          gameTitles = gameTitles,
          mapMasters = mapMasters,
          seasonMasters = seasonMasters,
          now = IO.pure(now),
          nextId = ids.modify {
            case head :: tail => tail -> MatchId.unsafeFromString(head)
            case Nil => Nil -> MatchId.unsafeFromString("unexpected-match-id")
          },
          allowedMemberIds = IO.pure(allowedMembers),
        )
      yield Fixture(
        gameTitles,
        mapMasters,
        seasonMasters,
        heldEvents,
        matches,
        matchDrafts,
        retention,
        usecase,
      )
    }

  private object ConfirmationConflictRepository extends MatchConfirmationRepository[IO]:
    override def confirm(
        record: MatchRecord,
        draft: Option[MatchDraftConfirmation],
        updatedAt: Instant,
    ): IO[Either[AppError, MatchConfirmationResult]] =
      IO.pure(Left(AppError.Conflict("confirmation conflict")))

  private object UnavailableImageStorage extends ImageStorage[IO]:
    override def save(
        ownerAccountId: AccountId,
        fileName: Option[String],
        contentType: Option[String],
        bytes: Array[Byte],
    ): IO[Either[AppError, StoredImage]] = unavailable

    override def find(imageId: ImageId): IO[Option[StoredImage]] = unavailable

    override def readStream(image: StoredImage): Stream[IO, Byte] =
      Stream.raiseError[IO](new RuntimeException("object storage unavailable"))

    override def delete(imageId: ImageId): IO[Boolean] = unavailable

    private def unavailable[A]: IO[A] = IO
      .raiseError(new RuntimeException("object storage unavailable"))
