package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent, MatchRecord}
import momo.api.errors.AppError
import momo.api.repositories.{MatchConfirmationResult, MatchDraftConfirmation}
import momo.api.usecases.testing.MatchFixtures

final class InMemoryMatchConfirmationRepositorySpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-15T00:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held-in-memory-confirmation")
  private val titleId = GameTitleId.unsafeFromString("title-in-memory-confirmation")
  private val seasonId = SeasonMasterId.unsafeFromString("season-in-memory-confirmation")
  private val mapId = MapMasterId.unsafeFromString("map-in-memory-confirmation")
  private val ownerMemberId = MemberId.unsafeFromString(MatchFixtures.DevMemberValues.head)
  private val draftId = MatchDraftId.unsafeFromString("draft-in-memory-confirmation")

  test("confirm preserves the draft when creating the match fails"):
    for
      matches <- InMemoryMatchesRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      confirmations = InMemoryMatchConfirmationRepository[IO](matches, matches.create, matchDrafts)
      currentDraft = draft()
      existing = record("match-in-memory-confirm-existing", 1)
      duplicate = record("match-in-memory-confirm-duplicate", 1)
      _ <- matchDrafts.create(currentDraft)
      _ <- matches.create(existing)
      result <- confirmations
        .confirm(duplicate, Some(MatchDraftConfirmation.from(currentDraft)), now.plusSeconds(60))
      storedDraft <- matchDrafts.find(draftId)
      existingFound <- matches.find(existing.id)
      duplicateFound <- matches.find(duplicate.id)
    yield
      assertEquals(
        result,
        Left(AppError.Conflict(
          "matchNoInEvent 1 already exists for held event held-in-memory-confirmation."
        )),
      )
      assertEquals(storedDraft.map(_.status), Some(MatchDraftStatus.DraftReady))
      assertEquals(storedDraft.flatMap(_.confirmedMatchId), None)
      assertEquals(existingFound.map(_.id), Some(existing.id))
      assertEquals(duplicateFound, None)

  test("confirm rejects a snapshot changed between the preflight read and atomic transition"):
    for
      matches <- InMemoryMatchesRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      currentDraft = draft()
      concurrentlyUpdated = currentDraft.withCommon(_.copy(layoutFamily = Some("changed")))
      recordToConfirm = record("match-in-memory-stale-snapshot", 1)
      createAfterConcurrentUpdate = (record: MatchRecord) =>
        matchDrafts.update(concurrentlyUpdated, now.plusSeconds(30)).void *> matches.create(record)
      confirmations = InMemoryMatchConfirmationRepository[IO](
        matches,
        createAfterConcurrentUpdate,
        matchDrafts,
      )
      _ <- matchDrafts.create(currentDraft)
      result <- confirmations.confirm(
        recordToConfirm,
        Some(MatchDraftConfirmation.from(currentDraft)),
        now.plusSeconds(60),
      )
      storedDraft <- matchDrafts.find(draftId)
      storedMatch <- matches.find(recordToConfirm.id)
    yield
      assertEquals(result, Right(MatchConfirmationResult.DraftSnapshotMismatch))
      assertEquals(storedDraft.map(_.layoutFamily), Some(Some("changed")))
      assertEquals(storedDraft.map(_.updatedAt), Some(now.plusSeconds(30)))
      assertEquals(storedDraft.flatMap(_.confirmedMatchId), None)
      assertEquals(storedMatch, None)

  private def draft(): MatchDraft = MatchDraft.fromInputs(
    id = draftId,
    createdByAccountId = AccountId.unsafeFromString(ownerMemberId.value),
    createdByMemberId = Some(ownerMemberId),
    status = MatchDraftStatus.DraftReady,
    heldEventId = Some(heldEventId),
    matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(1)),
    gameTitleId = Some(titleId),
    layoutFamily = Some("world"),
    seasonMasterId = Some(seasonId),
    ownerMemberId = Some(ownerMemberId),
    mapMasterId = Some(mapId),
    playedAt = Some(now),
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = None,
    createdAt = now,
    updatedAt = now,
  ).fold(error => fail(error.message), identity)

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
