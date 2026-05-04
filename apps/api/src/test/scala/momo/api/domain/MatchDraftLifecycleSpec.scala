package momo.api.domain

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.InMemoryMatchDraftsRepository
import momo.api.domain.ids.*

final class MatchDraftLifecycleSpec extends CatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-04T10:00:00Z")
  private val laterAt = Instant.parse("2026-05-04T10:05:00Z")

  private def newEditing(status: MatchDraftStatus): MatchDraft.Editing = MatchDraft.Editing(
    id = MatchDraftId("d1"),
    createdByMemberId = MemberId("m1"),
    status = status,
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    createdAt = createdAt,
    updatedAt = createdAt,
  )

  test("Editing → Confirmed via markConfirmed; subsequent transitions return false"):
    for
      repo <- InMemoryMatchDraftsRepository.create[IO]
      draft = newEditing(MatchDraftStatus.DraftReady)
      _ <- repo.create(draft)
      ok <- repo.markConfirmed(draft.id, MatchId("match_1"), laterAt)
      _ = assert(ok)
      after <- repo.find(draft.id)
      _ = after match
        case Some(c: MatchDraft.Confirmed) =>
          assertEquals(c.confirmedMatchIdValue, MatchId("match_1"))
          assertEquals(c.confirmedMatchId, Some(MatchId("match_1")))
          assertEquals(c.status, MatchDraftStatus.Confirmed)
          assertEquals(c.updatedAt, laterAt)
        case other => fail(s"expected Confirmed, got $other")
      // a second confirm attempt on a non-Editing draft should fail
      ok2 <- repo.markConfirmed(draft.id, MatchId("match_2"), laterAt)
    yield assert(!ok2)

  test("cancel only succeeds on Editing; idempotent calls return false on Cancelled"):
    for
      repo <- InMemoryMatchDraftsRepository.create[IO]
      draft = newEditing(MatchDraftStatus.NeedsReview)
      _ <- repo.create(draft)
      ok <- repo.cancel(draft.id, laterAt)
      _ = assert(ok)
      after <- repo.find(draft.id)
      _ = after match
        case Some(_: MatchDraft.Cancelled) => ()
        case other => fail(s"expected Cancelled, got $other")
      ok2 <- repo.cancel(draft.id, laterAt)
    yield assert(!ok2)

  test("smart factory falls back to Editing if status=Confirmed but confirmedMatchId is None"):
    val d = MatchDraft(
      id = MatchDraftId("d2"),
      createdByMemberId = MemberId("m1"),
      status = MatchDraftStatus.Confirmed,
      heldEventId = None,
      matchNoInEvent = None,
      gameTitleId = None,
      layoutFamily = None,
      seasonMasterId = None,
      ownerMemberId = None,
      mapMasterId = None,
      playedAt = None,
      totalAssetsImageId = None,
      revenueImageId = None,
      incidentLogImageId = None,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
      sourceImagesRetainedUntil = None,
      sourceImagesDeletedAt = None,
      confirmedMatchId = None,
      createdAt = createdAt,
      updatedAt = createdAt,
    )
    assert(d match
      case _: MatchDraft.Editing => true
      case _ => false)
end MatchDraftLifecycleSpec
