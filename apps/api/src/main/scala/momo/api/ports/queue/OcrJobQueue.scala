package momo.api.ports.queue

import java.nio.file.Path
import java.time.Instant

import cats.Applicative

import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}

final case class OcrJobEnqueueRequest(
    jobId: OcrJobId,
    draftId: OcrDraftId,
    imageId: ImageId,
    imagePath: Path,
    requestedScreenType: ScreenType,
    attempt: Int,
    enqueuedAt: Instant,
    hints: OcrJobHints,
    requestId: Option[String],
)

object OcrJobEnqueueRequest:
  val InitialAttempt = 1

trait OcrJobQueuePublisher[F[_]]:
  def publish(request: OcrJobEnqueueRequest): F[String]

trait OcrJobQueueHealthCheck[F[_]]:
  def ping: F[Unit]
  def deadLetterLength: F[Long]

object OcrJobQueueHealthCheck:
  def healthy[F[_]: Applicative]: OcrJobQueueHealthCheck[F] = new OcrJobQueueHealthCheck[F]:
    override def ping: F[Unit] = Applicative[F].unit
    override def deadLetterLength: F[Long] = Applicative[F].pure(0L)
