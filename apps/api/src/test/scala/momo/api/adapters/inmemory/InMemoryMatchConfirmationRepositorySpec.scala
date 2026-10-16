package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent, MatchRecord}
import momo.api.repositories.MatchDraftConfirmation
import momo.api.repositories.contract.MatchConfirmationRepositoryContract
import momo.api.repositories.contract.MatchConfirmationRepositoryContract.{
  Fixture as ConfirmationFixture,
  State
}
import momo.api.usecases.testing.MatchFixtures

final class InMemoryMatchConfirmationRepositorySpec
    extends MomoCatsEffectSuite with MatchConfirmationRepositoryContract:
  private def now = Instant.parse("2026-05-15T00:00:00Z")
  private def heldEventId = HeldEventId.unsafeFromString("held-in-memory-confirmation")
  private def titleId = GameTitleId.unsafeFromString("title-in-memory-confirmation")
  private def seasonId = SeasonMasterId.unsafeFromString("season-in-memory-confirmation")
  private def mapId = MapMasterId.unsafeFromString("map-in-memory-confirmation")
  private def ownerMemberId = MemberId.unsafeFromString(MatchFixtures.DevMemberValues.head)
  private def draftId = MatchDraftId.unsafeFromString("draft-in-memory-confirmation")

  override protected def confirmationFixture(status: MatchDraftStatus): IO[ConfirmationFixture] =
    for
      matches <- InMemoryMatchesRepository.create[IO]
      drafts <- InMemoryMatchDraftsRepository.create[IO]
      confirmations = InMemoryMatchConfirmationRepository[IO](matches, matches.create, drafts)
      current = draft(status)
      rec = record("match-contract", 1)
      _ <- drafts.create(current)
    yield ConfirmationFixture(
      snapshot = MatchDraftConfirmation.from(current),
      matchId = rec.id,
      confirmedAt = now.plusSeconds(60),
      confirm = expected => confirmations.confirm(rec, Some(expected), now.plusSeconds(60)),
      readState =
        for
          saved <- drafts.find(draftId).map(_.getOrElse(fail("draft disappeared")))
          found <- matches.find(rec.id)
        yield State(saved.status, saved.confirmedMatchId, saved.updatedAt, found.nonEmpty),
    )

  private def draft(status: MatchDraftStatus): MatchDraft =
    MatchDraft.fromInputs(
      id = draftId,
      createdByAccountId = AccountId.unsafeFromString(ownerMemberId.value),
      createdByMemberId = Some(ownerMemberId),
      status = status,
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
