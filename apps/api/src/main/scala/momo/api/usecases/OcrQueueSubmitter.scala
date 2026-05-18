package momo.api.usecases

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, Temporal}
import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, OcrFailure}
import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.{
  MatchDraftsRepository, OcrJobsRepository, OcrQueueOutboxDraft, OcrQueueOutboxRepository,
  OcrQueuePayload, QueueProducer,
}

trait OcrQueueSubmitter[F[_]]:
  def submit(context: OcrQueueSubmitter.Context): F[Either[AppError, Unit]]

object OcrQueueSubmitter:
  final case class Context(
      payload: OcrQueuePayload,
      jobId: OcrJobId,
      draftId: OcrDraftId,
      matchDraftId: Option[MatchDraftId],
      createdAt: Instant,
  )

  def deferred[F[_]: Applicative]: OcrQueueSubmitter[F] = new OcrQueueSubmitter[F]:
    override def submit(context: Context): F[Either[AppError, Unit]] =
      val _ = context
      ().asRight[AppError].pure[F]

  def direct[F[_]: MonadThrow: LoggerFactory](
      jobs: OcrJobsRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      queue: QueueProducer[F],
  ): OcrQueueSubmitter[F] = new OcrQueueSubmitter[F]:
    private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OcrQueueSubmitter[F]])

    override def submit(context: Context): F[Either[AppError, Unit]] = queue
      .publish(context.payload).redeemWith(
        error =>
          val originalErrorClasses = SafeLog.throwableClasses(error)
          val logOriginal = logger.error(s"OCR enqueue publish failed jobId=${context.jobId
              .value} draftId=${context.draftId.value} matchDraftId=${context.matchDraftId
              .fold("none")(_.value)} errorClasses=$originalErrorClasses")
          val markDraftFailure = context.matchDraftId match
            case Some(id) => matchDrafts.markOcrFailed(id, context.createdAt).void
            case None => MonadThrow[F].unit
          // Run compensation (mark job/draft failed) and log any secondary failure so it is not
          // silently swallowed. Logged fields are restricted to identifiers and throwable classes.
          val compensate =
            (jobs.markFailed(context.jobId, queueFailure, context.createdAt) >> markDraftFailure)
              .attempt.flatMap {
                case Right(_) => MonadThrow[F].unit
                case Left(compensationError) =>
                  val compensationErrorClasses = SafeLog.throwableClasses(compensationError)
                  val matchDraftId = context.matchDraftId.fold("none")(_.value)
                  logger.error(
                    s"OCR enqueue compensation failed jobId=${context.jobId.value} draftId=${context
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

  def outboxBacked[F[_]: Temporal: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queue: QueueProducer[F],
  ): OcrQueueSubmitter[F] = outboxBacked(outbox, queue, 30.seconds, 60.seconds)

  def outboxBacked[F[_]: Temporal: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queue: QueueProducer[F],
      claimTtl: FiniteDuration,
      maxBackoff: FiniteDuration,
  ): OcrQueueSubmitter[F] = new OcrQueueSubmitter[F]:
    private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OcrQueueSubmitter[F]])
    private val publisher = OcrQueueOutboxPublisher[F](outbox, queue, maxBackoff)

    override def submit(context: Context): F[Either[AppError, Unit]] =
      val outboxId = OcrQueueOutboxDraft.idForJob(context.jobId)
      val publishAttempt =
        for
          now <- Clock[F].realTimeInstant
          claimed <- outbox.claimById(outboxId, now, now.plusMillis(claimTtl.toMillis))
          _ <- claimed match
            case Some(row) => publisher.publish(row)
            case None => logger.warn(
                s"OCR queue outbox immediate claim skipped outboxId=$outboxId " +
                  s"jobId=${context.jobId.value}"
              )
        yield ()

      publishAttempt.attempt.flatMap {
        case Right(_) => ().asRight[AppError].pure[F]
        case Left(error) =>
          val errorClasses = SafeLog.throwableClasses(error)
          logger.error(
            s"OCR queue outbox immediate publish failed outboxId=$outboxId " + s"jobId=${context
                .jobId.value} draftId=${context.draftId.value} " + s"errorClasses=$errorClasses"
          ) >> ().asRight[AppError].pure[F]
      }

  private val queueFailure: OcrFailure = OcrFailure(
    code = FailureCode.QueueFailure,
    message = "Failed to enqueue OCR job.",
    retryable = false,
    userAction = Some("運用に連絡してください"),
  )
