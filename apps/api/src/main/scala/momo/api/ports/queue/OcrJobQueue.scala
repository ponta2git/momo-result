package momo.api.ports.queue

import java.time.Instant

import cats.Applicative

import momo.api.domain.ids.*
import momo.api.domain.{OcrJob, OcrJobHints, ScreenType, StoredImage, StoredImageLocation}

final case class OcrJobEnqueueRequest(
    jobId: OcrJobId,
    draftId: OcrDraftId,
    imageId: ImageId,
    imageLocation: StoredImageLocation,
    imageSha256: String,
    imageByteLength: Long,
    imageMediaType: String,
    requestedScreenType: ScreenType,
    attempt: Int,
    enqueuedAt: Instant,
    hints: OcrJobHints,
    requestId: Option[String],
)

object OcrJobEnqueueRequest:
  val InitialAttempt = 1

  def initial(
      job: OcrJob.Queued,
      image: StoredImage,
      hints: OcrJobHints,
      requestId: Option[String],
  ): OcrJobEnqueueRequest = OcrJobEnqueueRequest(
    jobId = job.id,
    draftId = job.draftId,
    imageId = image.imageId,
    imageLocation = image.location,
    imageSha256 = image.sha256,
    imageByteLength = image.sizeBytes,
    imageMediaType = image.mediaType,
    requestedScreenType = job.requestedScreenType,
    attempt = InitialAttempt,
    enqueuedAt = job.createdAt,
    hints = hints,
    requestId = requestId,
  )

trait OcrJobQueuePublisher[F[_]]:
  def publish(request: OcrJobEnqueueRequest): F[String]

trait OcrJobQueueHealthCheck[F[_]]:
  def ping: F[Unit]
  def deadLetterLength: F[Long]

object OcrJobQueueHealthCheck:
  def healthy[F[_]: Applicative]: OcrJobQueueHealthCheck[F] = new OcrJobQueueHealthCheck[F]:
    override def ping: F[Unit] = Applicative[F].unit
    override def deadLetterLength: F[Long] = Applicative[F].pure(0L)
