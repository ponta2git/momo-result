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

trait OcrJobCreationRepository[F[_]]:
  def createQueuedJob(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      enqueueRequest: OcrJobEnqueueRequest,
      activeJobLimit: Int,
  ): F[OcrJobCreationRepository.CreateQueuedJobResult]

object OcrJobCreationRepository:
  type CreateQueuedJobResult = Either[CreateQueuedJobRejection, Unit]

  enum CreateQueuedJobRejection derives CanEqual:
    case ActiveJobLimitExceeded(limit: Int)
    case MatchDraftAttachFailed(draftId: MatchDraftId)
