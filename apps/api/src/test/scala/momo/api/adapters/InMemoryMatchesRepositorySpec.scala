package momo.api.adapters

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.MatchRecord
import momo.api.domain.ids.*
import momo.api.errors.AppException
import momo.api.usecases.testing.MatchFixtures

final class InMemoryMatchesRepositorySpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-15T00:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held-in-memory-matches")
  private val titleId = GameTitleId.unsafeFromString("title-in-memory-matches")
  private val seasonId = SeasonMasterId.unsafeFromString("season-in-memory-matches")
  private val mapId = MapMasterId.unsafeFromString("map-in-memory-matches")

  test("create rejects duplicate match number for the same held event"):
    for
      matches <- InMemoryMatchesRepository.create[IO]
      first = record("match-in-memory-1", 1)
      second = record("match-in-memory-2", 1)
      _ <- matches.create(first)
      result <- matches.create(second).attempt
      listed <- matches.listByHeldEvent(heldEventId)
    yield
      assertAppError(result, "CONFLICT", "already exists for held event")
      assertEquals(listed.map(_.id), List(first.id))

  test("update rejects missing matches instead of inserting them"):
    for
      matches <- InMemoryMatchesRepository.create[IO]
      missing = record("match-in-memory-missing", 1)
      result <- matches.update(missing, now.plusSeconds(60)).attempt
      found <- matches.find(missing.id)
    yield
      assertAppError(result, "NOT_FOUND", "match was not found")
      assertEquals(found, None)

  test("update rejects duplicate match number and preserves the existing record"):
    for
      matches <- InMemoryMatchesRepository.create[IO]
      first = record("match-in-memory-1", 1)
      second = record("match-in-memory-2", 2)
      _ <- matches.create(first)
      _ <- matches.create(second)
      result <- matches.update(first.copy(matchNoInEvent = second.matchNoInEvent), now).attempt
      found <- matches.find(first.id)
    yield
      assertAppError(result, "CONFLICT", "already exists for held event")
      assertEquals(found.map(_.matchNoInEvent), Some(first.matchNoInEvent))

  private def record(id: String, matchNoInEvent: Int): MatchRecord = MatchFixtures.matchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = matchNoInEvent,
    titleId = titleId,
    seasonId = seasonId,
    mapId = mapId,
    playedAt = now,
    createdAt = now,
    memberValues = MatchFixtures.DevMemberValues,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
  )

  private def assertAppError(
      result: Either[Throwable, Unit],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
    case Left(error: AppException) =>
      assertEquals(error.error.code, expectedCode)
      assert(
        error.error.detail.contains(detailContains),
        s"unexpected detail: ${error.error.detail}",
      )
    case Left(error) => fail(s"expected AppException($expectedCode), got $error")
    case Right(_) => fail(s"expected AppException($expectedCode), got success")
