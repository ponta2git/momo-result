package momo.api.usecases

import java.time.Instant

import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, OcrFailure}
import momo.api.errors.AppError
import momo.api.repositories.{MatchDraftsRepository, OcrJobsRepository, OcrQueuePayload, QueueProducer}

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

    override def submit(context: Context): F[Either[AppError, Unit]] =
      queue.publish(context.payload).redeemWith(
        error =>
          val logOriginal = logger.error(s"OCR enqueue publish failed jobId=${context.jobId
              .value} draftId=${context.draftId.value} matchDraftId=${context.matchDraftId
              .fold("none")(_.value)} errorClass=${error.getClass.getName}")
          val markDraftFailure = context.matchDraftId match
            case Some(id) => matchDrafts.markOcrFailed(id, context.createdAt).void
            case None => MonadThrow[F].unit
          // Run compensation (mark job/draft failed) and log any secondary failure so it is not
          // silently swallowed. Logged fields are restricted to identifiers and throwable classes.
          val compensate =
            (jobs.markFailed(context.jobId, queueFailure, context.createdAt) >> markDraftFailure)
              .attempt.flatMap {
                case Right(_) => MonadThrow[F].unit
                case Left(compensationError) => logger
                    .error(compensationError)(s"OCR enqueue compensation failed jobId=${context
                        .jobId.value} draftId=${context.draftId.value}" + s" matchDraftId=${context
                        .matchDraftId.fold("none")(_.value)} originalError=" +
                        s"${error.getClass.getName}")
              }
          logOriginal >> compensate >>
            AppError.DependencyFailed("Failed to enqueue OCR job.").asLeft[Unit].pure[F]
        ,
        _ => ().asRight[AppError].pure[F],
      )

  private val queueFailure: OcrFailure = OcrFailure(
    code = FailureCode.QueueFailure,
    message = "Failed to enqueue OCR job.",
    retryable = false,
    userAction = Some("運用に連絡してください"),
  )
