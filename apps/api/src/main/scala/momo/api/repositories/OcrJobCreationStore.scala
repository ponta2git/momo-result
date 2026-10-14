package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, OcrJob, OcrJobInput, ScreenType}

final case class OcrJobDraftAttachment(
    draftId: MatchDraftId,
    screenType: ScreenType,
    sourceImageId: ImageId,
    ocrDraftId: OcrDraftId,
    updatedAt: Instant,
)

final case class OcrJobSubmissionBinding(submissionId: String, ownerAccountId: AccountId)

final case class StoredOcrJob(job: OcrJob, draft: OcrDraft, created: Boolean)

final case class OcrJobCreationPlan(
    submission: OcrJobSubmissionBinding,
    draft: OcrDraft,
    job: OcrJob,
    matchDraftAttachment: OcrJobDraftAttachment,
    input: OcrJobInput,
    activeJobLimit: Int,
)

object OcrJobCreationPlan:
  /** Validates the accepted input and attached records before storing the job. */
  def isConsistent(plan: OcrJobCreationPlan): Boolean =
    val request = plan.input
    val attachment = plan.matchDraftAttachment
    plan.job.status == momo.api.domain.OcrJobStatus.Queued &&
    plan.draft.jobId == plan.job.id &&
    plan.job.draftId == plan.draft.id &&
    request.jobId == plan.job.id &&
    request.draftId == plan.draft.id &&
    request.imageId == plan.job.imageId &&
    request.imageLocation == plan.job.imageLocation &&
    request.requestedScreenType == plan.job.requestedScreenType &&
    attachment.sourceImageId == plan.job.imageId &&
    attachment.ocrDraftId == plan.draft.id &&
    attachment.screenType == plan.job.requestedScreenType &&
    attachment.updatedAt.equals(plan.job.createdAt)

trait OcrJobCreationStore[F[_]]:
  def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult]

object OcrJobCreationStore:
  type OcrJobCreationResult = Either[OcrJobCreationRejection, StoredOcrJob]

  enum OcrJobCreationRejection derives CanEqual:
    case InvalidPlan
    case SubmissionRejected
    case ActiveJobLimitExceeded(limit: Int)
    case MatchDraftAttachmentRejected(draftId: MatchDraftId)
    case SourceImageUnavailable(imageId: ImageId)
