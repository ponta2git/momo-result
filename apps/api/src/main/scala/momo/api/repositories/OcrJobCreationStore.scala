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
    jobId: OcrJobId,
    draftId: OcrDraftId,
    matchDraftId: Option[MatchDraftId],
    createdAt: Instant,
)

final case class OcrJobCreationPlan(
    draft: OcrDraft,
    job: OcrJob,
    matchDraftAttachment: Option[OcrJobDraftAttachment],
    queueDispatch: OcrQueueDispatchIntent,
    activeJobLimit: Int,
)

trait OcrJobCreationStore[F[_]]:
  def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult]

object OcrJobCreationStore:
  type OcrJobCreationResult = Either[OcrJobCreationRejection, Unit]

  enum OcrJobCreationRejection derives CanEqual:
    case ActiveJobLimitExceeded(limit: Int)
    case MatchDraftAttachmentRejected(draftId: MatchDraftId)
