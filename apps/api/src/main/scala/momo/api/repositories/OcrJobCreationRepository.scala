package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, OcrJob, ScreenType}

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
      queuePayload: OcrQueuePayload,
      activeJobLimit: Int,
  ): F[Unit]

object OcrJobCreationRepository:
  final class MatchDraftAttachFailed(val draftId: MatchDraftId)
      extends RuntimeException(s"match draft ${draftId.value} could not be attached to OCR job")
  final class ActiveJobLimitExceeded(val limit: Int)
      extends RuntimeException(s"active OCR job limit exceeded: ${limit.toString}")
