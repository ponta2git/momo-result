package momo.api.repositories.contract

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.{MatchId, OcrDraftId}
import momo.api.errors.AppError
import momo.api.repositories.{MatchConfirmationResult, MatchDraftConfirmation}

/** Shared state and snapshot guards; transaction rollback remains in the Postgres suite. */
trait MatchConfirmationRepositoryContract:
  this: CatsEffectSuite =>

  import MatchConfirmationRepositoryContract.{Fixture as ConfirmationFixture, State}

  protected def confirmationFixture(status: MatchDraftStatus): IO[ConfirmationFixture]

  test("confirmation accepts draft_ready and links the stored match"):
    assertAccepted(MatchDraftStatus.DraftReady)

  test("confirmation accepts needs_review and links the stored match"):
    assertAccepted(MatchDraftStatus.NeedsReview)

  test("confirmation accepts ocr_failed and links the stored match"):
    assertAccepted(MatchDraftStatus.OcrFailed)

  test("confirmation rejects ocr_running without creating a match or changing the draft"):
    assertStatusRejected(MatchDraftStatus.OcrRunning)

  test("confirmation rejects cancelled without creating a match or changing the draft"):
    assertStatusRejected(MatchDraftStatus.Cancelled)

  test("confirmation rejects a stale timestamp without changing stored state"):
    assertSnapshotRejected(snapshot => snapshot.copy(updatedAt = snapshot.updatedAt.minusSeconds(1)))

  test("confirmation rejects different OCR references without changing stored state"):
    assertSnapshotRejected(_.copy(totalAssetsDraftId = Some(OcrDraftId.unsafeFromString("other-ocr"))))

  private def assertAccepted(status: MatchDraftStatus): IO[Unit] =
    for
      f <- confirmationFixture(status)
      result <- f.confirm(f.snapshot)
      state <- f.readState
    yield
      assertEquals(result, Right(MatchConfirmationResult.Confirmed))
      assertEquals(state, State(MatchDraftStatus.Confirmed, Some(f.matchId), f.confirmedAt, true))

  private def assertStatusRejected(status: MatchDraftStatus): IO[Unit] =
    for
      f <- confirmationFixture(status)
      before <- f.readState
      result <- f.confirm(f.snapshot)
      after <- f.readState
    yield
      assertEquals(result, Right(MatchConfirmationResult.DraftSnapshotMismatch))
      assertEquals(after, before)

  private def assertSnapshotRejected(
      change: MatchDraftConfirmation => MatchDraftConfirmation
  ): IO[Unit] =
    for
      f <- confirmationFixture(MatchDraftStatus.DraftReady)
      before <- f.readState
      result <- f.confirm(change(f.snapshot))
      after <- f.readState
    yield
      assertEquals(result, Right(MatchConfirmationResult.DraftSnapshotMismatch))
      assertEquals(after, before)

object MatchConfirmationRepositoryContract:
  final case class State(
      status: MatchDraftStatus,
      confirmedMatchId: Option[MatchId],
      updatedAt: Instant,
      matchExists: Boolean,
  )

  final case class Fixture(
      snapshot: MatchDraftConfirmation,
      matchId: MatchId,
      confirmedAt: Instant,
      confirm: MatchDraftConfirmation => IO[Either[AppError, MatchConfirmationResult]],
      readState: IO[State],
  )
