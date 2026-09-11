package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, OcrJob, ScreenType}
import momo.api.ports.queue.OcrJobEnqueueRequest

final case class OcrJobDraftAttachment(
    draftId: MatchDraftId,
    screenType: ScreenType,
    sourceImageId: ImageId,
    ocrDraftId: OcrDraftId,
    updatedAt: Instant,
)

final case class OcrQueueDispatchIntent(
    enqueueRequest: OcrJobEnqueueRequest,
    matchDraftId: MatchDraftId,
):
  def jobId: OcrJobId = enqueueRequest.jobId
  def draftId: OcrDraftId = enqueueRequest.draftId
  def createdAt: Instant = enqueueRequest.enqueuedAt

final case class OcrJobCreationPlan(
    draft: OcrDraft,
    job: OcrJob,
    matchDraftAttachment: OcrJobDraftAttachment,
    queueDispatch: OcrQueueDispatchIntent,
    activeJobLimit: Int,
)

object OcrJobCreationPlan:
  /** Validates the queue/DB boundary before any row or outbox mutation. */
  def isConsistent(plan: OcrJobCreationPlan): Boolean =
    val request = plan.queueDispatch.enqueueRequest
    val attachment = plan.matchDraftAttachment
    plan.job.status == momo.api.domain.OcrJobStatus.Queued &&
    plan.draft.jobId == plan.job.id &&
    plan.job.draftId == plan.draft.id &&
    plan.queueDispatch.matchDraftId == attachment.draftId &&
    request.jobId == plan.job.id &&
    request.draftId == plan.draft.id &&
    request.imageId == plan.job.imageId &&
    request.imageLocation == plan.job.imageLocation &&
    request.requestedScreenType == plan.job.requestedScreenType &&
    request.attempt == OcrJobEnqueueRequest.InitialAttempt &&
    attachment.sourceImageId == plan.job.imageId &&
    attachment.ocrDraftId == plan.draft.id &&
    attachment.screenType == plan.job.requestedScreenType &&
    attachment.updatedAt.equals(request.enqueuedAt)

trait OcrJobCreationStore[F[_]]:
  def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult]

object OcrJobCreationStore:
  type OcrJobCreationResult = Either[OcrJobCreationRejection, Unit]

  enum OcrJobCreationRejection derives CanEqual:
    case InvalidPlan
    case ActiveJobLimitExceeded(limit: Int)
    case MatchDraftAttachmentRejected(draftId: MatchDraftId)
    case SourceImageUnavailable(imageId: ImageId)
