package momo.api.repositories.contract

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.ids.{AccountId, MatchDraftId}
import momo.api.domain.{MatchDraft, OcrDraft, OcrJob, OcrSubmission}
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{OcrJobCreationPlan, OcrJobCreationStore, StoredOcrJob}

/**
 * Shared admission and replay semantics for the HTTP test adapter and the durable adapter.
 * Reads use repository ports, so successful creation and rejected writes are observable through
 * the same boundary as their consumers. SQL locking, rollback and durable outbox stay in DB specs.
 */
trait OcrJobCreationStoreContract:
  this: CatsEffectSuite =>

  import OcrJobCreationStoreContract.*

  protected def freshCreationFixture(admissionDeadline: Instant): IO[CreationFixture]

  private def fixture: IO[CreationFixture] = IO.realTimeInstant
    .flatMap(now => freshCreationFixture(now.plusSeconds(3600)))

  test("creation links the same job, OCR draft and submission member to the source draft"):
    for
      f <- fixture
      created <- f.store.store(f.plan)
      saved <- f.readState
    yield
      assertEquals(created, Right(StoredOcrJob(f.plan.job, f.plan.draft, true)))
      assertEquals(saved.job, Some(f.plan.job))
      assertEquals(saved.ocrDraft, Some(f.plan.draft))
      assertEquals(saved.matchDraft.flatMap(_.totalAssetsImageId), Some(f.plan.job.imageId))
      assertEquals(saved.matchDraft.flatMap(_.totalAssetsDraftId), Some(f.plan.draft.id))
      assertEquals(
        saved.submission.toList.flatMap(_.members).map(m => (m.status, m.jobId)),
        List(("registered", Some(f.plan.job.id)))
      )

  test("active admission limit rejects creation without changing the source or submission"):
    assertRejectedWithoutMutation(
      _.copy(activeJobLimit = 0),
      OcrJobCreationRejection.ActiveJobLimitExceeded(0)
    )

  test("inconsistent source image identity is rejected before any mutation"):
    assertRejectedWithoutMutation(
      p =>
        p.copy(matchDraftAttachment =
          p.matchDraftAttachment.copy(
            sourceImageId = momo.api.domain.ids.ImageId.unsafeFromString("other-image")
          )
        ),
      OcrJobCreationRejection.InvalidPlan,
    )

  test("a submission cannot register a job against another source draft"):
    assertRejectedWithoutMutation(otherSourceDraft, OcrJobCreationRejection.SubmissionRejected)

  test("a submission cannot be used by another account"):
    assertRejectedWithoutMutation(
      p =>
        p.copy(submission =
          p.submission.copy(
            ownerAccountId = AccountId.unsafeFromString("account_eu")
          )
        ),
      OcrJobCreationRejection.SubmissionRejected,
    )

  test("a registered job replays without taking quota but retains its original source binding"):
    for
      f <- fixture
      _ <- f.store.store(f.plan)
      before <- f.readState
      replay <- f.store.store(f.plan.copy(activeJobLimit = 0))
      wrongDraft <- f.store.store(otherSourceDraft(f.plan))
      after <- f.readState
    yield
      assertEquals(replay, Right(StoredOcrJob(f.plan.job, f.plan.draft, false)))
      assertEquals(wrongDraft, Left(OcrJobCreationRejection.SubmissionRejected))
      assertEquals(after, before)

  test("expired admission rejects an old request even when its creation time preceded expiry"):
    for
      now <- IO.realTimeInstant
      f <- freshCreationFixture(now.minusSeconds(3600))
      before <- f.readState
      result <- f.store.store(f.plan)
      after <- f.readState
    yield
      assert(f.plan.job.createdAt.isBefore(now.minusSeconds(3600)))
      assertEquals(result, Left(OcrJobCreationRejection.SubmissionRejected))
      assertEquals(after, before)

  private def assertRejectedWithoutMutation(
      change: OcrJobCreationPlan => OcrJobCreationPlan,
      expected: OcrJobCreationRejection,
  ): IO[Unit] = IO.defer {
    for
      f <- fixture
      before <- f.readState
      result <- f.store.store(change(f.plan))
      after <- f.readState
    yield
      assertEquals(result, Left(expected))
      assertEquals(after, before)
  }

  private def otherSourceDraft(plan: OcrJobCreationPlan): OcrJobCreationPlan =
    val other = MatchDraftId.unsafeFromString("other-match-draft")
    plan.copy(
      matchDraftAttachment = plan.matchDraftAttachment.copy(draftId = other),
      queueDispatch = plan.queueDispatch.copy(matchDraftId = other),
    )

object OcrJobCreationStoreContract:
  final case class CreationState(
      job: Option[OcrJob],
      ocrDraft: Option[OcrDraft],
      matchDraft: Option[MatchDraft],
      submission: Option[OcrSubmission],
  )

  final case class CreationFixture(
      store: OcrJobCreationStore[IO],
      plan: OcrJobCreationPlan,
      readState: IO[CreationState],
  )
