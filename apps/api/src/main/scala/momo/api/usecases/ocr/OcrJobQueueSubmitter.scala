package momo.api.usecases.ocr

import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.{FailureCode, OcrFailure}
import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.ports.queue.OcrJobQueuePublisher
import momo.api.repositories.{MatchDraftsRepository, OcrJobsRepository, OcrQueueDispatchIntent}

trait OcrJobQueueSubmitter[F[_]]:
  def submit(intent: OcrQueueDispatchIntent): F[Either[AppError, Unit]]

object OcrJobQueueSubmitter:
  /**
   * Non-durable adapter for the explicitly in-memory development runtime and focused use-case
   * tests. PostgreSQL wiring must use [[durable]] plus the shared outbox wake coordinator.
   */
  private[api] def nonDurable[F[_]: MonadThrow: LoggerFactory](
      jobs: OcrJobsRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      queue: OcrJobQueuePublisher[F],
  ): OcrJobQueueSubmitter[F] = new OcrJobQueueSubmitter[F]:
    private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OcrJobQueueSubmitter[F]])

    override def submit(intent: OcrQueueDispatchIntent): F[Either[AppError, Unit]] = queue
      .publish(intent.enqueueRequest).redeemWith(
        error =>
          val originalErrorClasses = SafeLog.throwableClasses(error)
          val logOriginal = logger.error(s"OCR enqueue publish failed jobId=${intent.jobId
              .value} draftId=${intent.draftId.value} matchDraftId=${intent.matchDraftId
              .fold("none")(_.value)} errorClasses=$originalErrorClasses")
          val markDraftFailure = intent.matchDraftId match
            case Some(id) => matchDrafts.markOcrFailed(id, intent.createdAt).void
            case None => MonadThrow[F].unit
          // Run compensation (mark job/draft failed) and log any secondary failure so it is not
          // silently swallowed. Logged fields are restricted to identifiers and throwable classes.
          val compensate =
            (jobs.markFailed(intent.jobId, queueFailure, intent.createdAt) >> markDraftFailure)
              .attempt.flatMap {
                case Right(_) => MonadThrow[F].unit
                case Left(compensationError) =>
                  val compensationErrorClasses = SafeLog.throwableClasses(compensationError)
                  val matchDraftId = intent.matchDraftId.fold("none")(_.value)
                  logger.error(
                    s"OCR enqueue compensation failed jobId=${intent.jobId.value} draftId=${intent
                        .draftId.value} matchDraftId=$matchDraftId " +
                      s"originalErrorClasses=$originalErrorClasses " +
                      s"compensationErrorClasses=$compensationErrorClasses"
                  )
              }
          logOriginal >> compensate >> AppError.DependencyFailed("Failed to enqueue OCR job.")
            .asLeft[Unit].pure[F]
        ,
        _ => ().asRight[AppError].pure[F],
      )

  /** The creation transaction already persisted the durable enqueue intent. */
  def durable[F[_]: Applicative]: OcrJobQueueSubmitter[F] = new OcrJobQueueSubmitter[F]:
    override def submit(_intent: OcrQueueDispatchIntent): F[Either[AppError, Unit]] =
      ().asRight[AppError].pure[F]

  private val queueFailure: OcrFailure = OcrFailure(
    code = FailureCode.QueueFailure,
    message = "Failed to enqueue OCR job.",
    retryable = false,
    userAction = Some("運用に連絡してください"),
  )
