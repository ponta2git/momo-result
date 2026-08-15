package momo.api.bootstrap

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.*
import momo.api.usecases.queue.{
  OutboxKind,
  OutboxWakeSink,
  OutboxWakeSubmitResult,
  PostCommitEffects
}

/** Adds process-local outbox wake hints after successful durable repository transitions. */
private[bootstrap] object OutboxWakingRepositories:
  def ocrJobCreation[F[_]: Async: LoggerFactory](
      delegate: OcrJobCreationStore[F],
      sink: OutboxWakeSink[F],
      onSinkClosed: F[Unit],
  ): OcrJobCreationStore[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new OcrJobCreationStore[F]:
      override def store(
          plan: OcrJobCreationPlan
      ): F[OcrJobCreationStore.OcrJobCreationResult] = wake(
        delegate.store(plan),
        OutboxKind.Ocr,
      )(_.isRight)

  def matches[F[_]: Async: LoggerFactory](
      delegate: MatchesRepository[F],
      sink: OutboxWakeSink[F],
      onSinkClosed: F[Unit],
  ): MatchesRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new MatchesRepository[F]:
      override def update(record: MatchRecord, updatedAt: Instant): F[Unit] = wake(
        delegate.update(record, updatedAt),
        OutboxKind.SeriesAnalysis,
      )(_ => true)

      override def delete(id: MatchId): F[Boolean] = wake(
        delegate.delete(id),
        OutboxKind.SeriesAnalysis,
      )(identity)

      override def find(id: MatchId): F[Option[MatchRecord]] = delegate.find(id)

      override def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]] =
        delegate.list(filter)

      override def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]] =
        delegate.listByHeldEvent(heldEventId)

      override def existsMatchNo(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
      ): F[Boolean] = delegate.existsMatchNo(heldEventId, matchNoInEvent)

      override def existsMatchNoExcept(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
          excludeMatchId: MatchId,
      ): F[Boolean] = delegate.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId)

      override def statsByHeldEvents(
          heldEventIds: List[HeldEventId]
      ): F[Map[HeldEventId, MatchesRepository.HeldEventStats]] =
        delegate.statsByHeldEvents(heldEventIds)

  def matchConfirmation[F[_]: Async: LoggerFactory](
      delegate: MatchConfirmationRepository[F],
      sink: OutboxWakeSink[F],
      onSinkClosed: F[Unit],
  ): MatchConfirmationRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new MatchConfirmationRepository[F]:
      override def confirm(
          record: MatchRecord,
          draft: Option[MatchDraftConfirmation],
          updatedAt: Instant,
      ): F[MatchConfirmationResult] = wake(
        delegate.confirm(record, draft, updatedAt),
        OutboxKind.SeriesAnalysis,
      )(_ == MatchConfirmationResult.Confirmed)

  def seriesAnalysis[F[_]: Async: LoggerFactory](
      delegate: SeriesAnalysisRepository[F],
      sink: OutboxWakeSink[F],
      onSinkClosed: F[Unit],
  ): SeriesAnalysisRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new SeriesAnalysisRepository[F]:
      override def options: F[Either[AppError, SeriesAnalysisOptions]] = delegate.options

      override def status(
          gameTitleId: GameTitleId
      ): F[Either[AppError, SeriesAnalysisStatus]] = delegate.status(gameTitleId)

      override def chunk(
          request: SeriesAnalysisChunkRequest
      ): F[Either[AppError, SeriesAnalysisChunk]] = delegate.chunk(request)

      override def adminOverview(
          gameTitleId: Option[GameTitleId]
      ): F[Either[AppError, SeriesAnalysisAdminOverview]] = delegate.adminOverview(gameTitleId)

      override def requestTitleRecalculation(
          gameTitleId: GameTitleId,
          requestedBy: AccountId,
          idempotencyKeyHash: String,
      ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = wake(
        delegate.requestTitleRecalculation(gameTitleId, requestedBy, idempotencyKeyHash),
        OutboxKind.SeriesAnalysis,
      )(_.isRight)

      override def requestAllRecalculation(
          requestedBy: AccountId,
          idempotencyKeyHash: String,
      ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = wake(
        delegate.requestAllRecalculation(requestedBy, idempotencyKeyHash),
        OutboxKind.SeriesAnalysis,
      )(_.isRight)

  private final class WakeAfterCommit[F[_]: Async: LoggerFactory](
      sink: OutboxWakeSink[F],
      onSinkClosed: F[Unit],
  ):
    private val logger = LoggerFactory[F].getLoggerFromName(
      "momo.api.bootstrap.OutboxWakingRepositories"
    )

    /**
     * Keeps the durable operation cancelable while masking only its successful result-to-signal
     * handoff. A closed process-local sink is escalated separately and never rewrites a committed
     * repository result as an HTTP failure.
     */
    def apply[A](operation: F[A], kind: OutboxKind)(shouldWake: A => Boolean): F[A] =
      Async[F].uncancelable { poll =>
        poll(operation).flatMap { result =>
          if shouldWake(result) then submit(kind).as(result)
          else result.pure[F]
        }
      }

    private def submit(kind: OutboxKind): F[Unit] = sink
      .submit(PostCommitEffects.wake(kind)).attempt.flatMap {
        case Right(OutboxWakeSubmitResult.Accepted) => Async[F].unit
        case Right(OutboxWakeSubmitResult.Closed) => escalate(kind, None)
        case Left(error) => escalate(kind, Some(error))
      }

    private def escalate(kind: OutboxKind, cause: Option[Throwable]): F[Unit] =
      val errorClasses = cause.fold("none")(SafeLog.throwableClasses)
      val log = logger.error(
        s"event=outbox_wake_sink_unavailable outboxKind=$kind " +
          s"errorClasses=$errorClasses committedResultPreserved=true"
      )
      log.attempt.void >> onSinkClosed.handleErrorWith { error =>
        val escalationErrorClasses = SafeLog.throwableClasses(error)
        logger.error(
          s"event=outbox_wake_sink_escalation_failed outboxKind=$kind " +
            s"errorClasses=$escalationErrorClasses committedResultPreserved=true"
        )
      }.attempt.void

  private object WakeAfterCommit:
    def apply[F[_]: Async: LoggerFactory](
        sink: OutboxWakeSink[F],
        onSinkClosed: F[Unit],
    ): WakeAfterCommit[F] = new WakeAfterCommit(sink, onSinkClosed)

end OutboxWakingRepositories
