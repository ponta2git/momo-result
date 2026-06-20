package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryHeldEventsRepository, InMemoryMapMastersRepository,
  InMemoryMatchDraftsRepository, InMemorySeasonMastersRepository,
}
import momo.api.domain.ids.*
import momo.api.testing.AppErrorAssertions.{assertAppError, assertRight}

final class CreateMatchDraftSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-08T10:00:00Z")
  private val draftId = MatchDraftId.unsafeFromString("draft-create-1")
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val memberId = Some(MemberId.unsafeFromString("member_ponta"))

  test("trims and stores layout family stable keys"):
    for
      fixture <- Fixture.create
      result <- fixture.usecase
        .run(blankCommand.copy(layoutFamily = Some(" world ")), accountId, memberId)
      found <- fixture.matchDrafts.find(draftId)
    yield
      val draft = assertRight(result)
      assertEquals(draft.layoutFamily, Some("world"))
      assertEquals(found.flatMap(_.layoutFamily), Some("world"))

  test("rejects invalid layout family keys"):
    for
      fixture <- Fixture.create
      result <- fixture.usecase
        .run(blankCommand.copy(layoutFamily = Some("World DX")), accountId, memberId)
      found <- fixture.matchDrafts.find(draftId)
    yield
      assertAppError(result, "VALIDATION_FAILED", "layoutFamily must match")
      assertEquals(found, None)

  test("returns Conflict when the repository rejects a generated duplicate id"):
    for
      fixture <- Fixture.create
      first <- fixture.usecase.run(blankCommand, accountId, memberId)
      duplicate <- fixture.usecase.run(blankCommand, accountId, memberId)
    yield
      assertEquals(first.map(_.id), Right(draftId))
      assertAppError(duplicate, "CONFLICT", "match draft already exists")

  private def blankCommand: CreateMatchDraftCommand = CreateMatchDraftCommand(
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    status = None,
  )

  private final case class Fixture(
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      usecase: CreateMatchDraft[IO],
  )

  private object Fixture:
    def create: IO[Fixture] =
      for
        heldEvents <- InMemoryHeldEventsRepository.create[IO]
        gameTitles <- InMemoryGameTitlesRepository.create[IO]
        mapMasters <- InMemoryMapMastersRepository.create[IO]
        seasonMasters <- InMemorySeasonMastersRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        usecase = CreateMatchDraft[IO](
          heldEvents = heldEvents,
          gameTitles = gameTitles,
          mapMasters = mapMasters,
          seasonMasters = seasonMasters,
          matchDrafts = matchDrafts,
          now = IO.pure(now),
          nextId = IO.pure(draftId),
        )
      yield Fixture(matchDrafts, usecase)
