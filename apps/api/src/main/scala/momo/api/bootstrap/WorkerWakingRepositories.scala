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
  PostCommitEffects,
  WorkerWakeKind,
  WorkerWakeSink,
  WorkerWakeSubmitResult
}

/** Adds worker wake hints after successful durable repository transitions. */
private[bootstrap] object WorkerWakingRepositories:
  def ocrJobCreation[F[_]: Async: LoggerFactory](
      delegate: OcrJobCreationStore[F],
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ): OcrJobCreationStore[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new OcrJobCreationStore[F]:
      override def store(
          plan: OcrJobCreationPlan
      ): F[OcrJobCreationStore.OcrJobCreationResult] = wake(
        delegate.store(plan),
        PostCommitEffects.wakeAll(WorkerWakeKind.ProcessingJobs, WorkerWakeKind.OcrSubmissions),
      )(_.exists(_.created))

  def ocrSubmissions[F[_]: Async: LoggerFactory](
      delegate: OcrSubmissionsRepository[F],
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ): OcrSubmissionsRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new OcrSubmissionsRepository[F]:
      export delegate.find

      override def put(submission: OcrSubmission): F[Either[AppError, OcrSubmission]] =
        wake(delegate.put(submission), WorkerWakeKind.OcrSubmissions)(_.isRight)

      override def failAdmission(
          owner: AccountId,
          keyHash: String,
          sha256: String,
          byteLength: Int,
      ): F[Unit] = wake(
        delegate.failAdmission(owner, keyHash, sha256, byteLength),
        WorkerWakeKind.OcrSubmissions,
      )(_ => true)

  def ocrJobs[F[_]: Async: LoggerFactory](
      delegate: OcrJobsRepository[F],
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ): OcrJobsRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new OcrJobsRepository[F]:
      export delegate.{find, countActive, backlogSnapshot}

      override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] =
        wake(delegate.cancelQueued(jobId, now), WorkerWakeKind.OcrSubmissions)(identity)

      override def cancelQueuedOwned(
          jobId: OcrJobId,
          owner: AccountId,
          now: Instant
      ): F[OcrJobCancellationResult] =
        wake(delegate.cancelQueuedOwned(jobId, owner, now), WorkerWakeKind.OcrSubmissions)(
          _ == OcrJobCancellationResult.Cancelled
        )

      override def cancelQueuedByDraftIds(ids: List[OcrDraftId], now: Instant): F[Int] =
        wake(delegate.cancelQueuedByDraftIds(ids, now), WorkerWakeKind.OcrSubmissions)(_ > 0)

  def matches[F[_]: Async: LoggerFactory](
      delegate: MatchesRepository[F],
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ): MatchesRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new MatchesRepository[F]:
      override def update(
          record: MatchRecord,
          updatedAt: Instant,
      ): F[Either[AppError, Unit]] = wake(
        delegate.update(record, updatedAt),
        WorkerWakeKind.ProcessingJobs,
      )(_.isRight)

      override def delete(id: MatchId): F[Boolean] = wake(
        delegate.delete(id),
        WorkerWakeKind.ProcessingJobs,
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
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ): MatchConfirmationRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new MatchConfirmationRepository[F]:
      override def confirm(
          record: MatchRecord,
          draft: Option[MatchDraftConfirmation],
          updatedAt: Instant,
      ): F[Either[AppError, MatchConfirmationResult]] = wake(
        delegate.confirm(record, draft, updatedAt),
        WorkerWakeKind.ProcessingJobs,
      )(_.contains(MatchConfirmationResult.Confirmed))

  def seriesAnalysis[F[_]: Async: LoggerFactory](
      delegate: SeriesAnalysisRepository[F],
      sink: WorkerWakeSink[F],
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

      override def scopeStatus(request: SeriesAnalysisScopeStatusRequest)
          : F[Either[AppError, SeriesAnalysisScopeStatus]] = delegate.scopeStatus(request)

      override def adminOverview(
          gameTitleId: Option[GameTitleId]
      ): F[Either[AppError, SeriesAnalysisAdminOverview]] = delegate.adminOverview(gameTitleId)

      override def requestTitleRecalculation(
          gameTitleId: GameTitleId,
          requestedBy: AccountId,
          idempotencyKeyHash: String,
      ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = wake(
        delegate.requestTitleRecalculation(gameTitleId, requestedBy, idempotencyKeyHash),
        WorkerWakeKind.ProcessingJobs,
      )(_.isRight)

      override def requestAllRecalculation(
          requestedBy: AccountId,
          idempotencyKeyHash: String,
      ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = wake(
        delegate.requestAllRecalculation(requestedBy, idempotencyKeyHash),
        WorkerWakeKind.ProcessingJobs,
      )(_.isRight)

  def seriesPlayerRadar[F[_]: Async: LoggerFactory](
      delegate: SeriesPlayerRadarRepository[F],
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ): SeriesPlayerRadarRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkClosed)
    new SeriesPlayerRadarRepository[F]:
      override def radarHistory(request: SeriesPlayerRadarHistoryRequest)
          : F[Either[AppError, SeriesPlayerRadarDocument]] = delegate.radarHistory(request)
      override def radarRevision(revisionId: String)
          : F[Either[AppError, SeriesPlayerRadarDocument]] = delegate.radarRevision(revisionId)
      override def radarState(title: GameTitleId): F[Either[AppError, SeriesPlayerRadarDocument]] =
        delegate.radarState(title)
      override def radarPreview(request: SeriesPlayerRadarPreviewRequest)
          : F[Either[AppError, SeriesPlayerRadarDocument]] = delegate.radarPreview(request)
      override def radarOperation(title: GameTitleId, operationId: String)
          : F[Either[AppError, SeriesPlayerRadarOperation]] =
        delegate.radarOperation(title, operationId)
      override def requestRadarOperation(
          command: SeriesPlayerRadarCommand,
          requestedBy: AccountId,
          idempotencyKeyHash: String,
          requestFingerprint: String
      )
          : F[Either[AppError, SeriesPlayerRadarOperation]] = wake(
        delegate.requestRadarOperation(
          command,
          requestedBy,
          idempotencyKeyHash,
          requestFingerprint
        ),
        WorkerWakeKind.ProcessingJobs,
      )(_.isRight)

  private final class WakeAfterCommit[F[_]: Async: LoggerFactory](
      sink: WorkerWakeSink[F],
      onSinkClosed: F[Unit],
  ):
    private val logger = LoggerFactory[F].getLoggerFromName(
      "momo.api.bootstrap.WorkerWakingRepositories"
    )

    /**
     * Keeps the durable operation cancelable while masking only its successful result-to-signal
     * handoff. An unavailable sink is reported separately and never rewrites a committed
     * repository result as an HTTP failure.
     */
    def apply[A](operation: F[A], kind: WorkerWakeKind)(shouldWake: A => Boolean): F[A] =
      apply(operation, PostCommitEffects.wake(kind))(shouldWake)

    def apply[A](operation: F[A], effects: PostCommitEffects)(shouldWake: A => Boolean): F[A] =
      Async[F].uncancelable { poll =>
        poll(operation).flatMap { result =>
          if shouldWake(result) then submit(effects).as(result)
          else result.pure[F]
        }
      }

    private def submit(effects: PostCommitEffects): F[Unit] = sink
      .submit(effects).attempt.flatMap {
        case Right(WorkerWakeSubmitResult.Accepted) => Async[F].unit
        case Right(WorkerWakeSubmitResult.Closed) => escalate(effects, None)
        case Left(error) => escalate(effects, Some(error))
      }

    private def escalate(effects: PostCommitEffects, cause: Option[Throwable]): F[Unit] =
      val errorClasses = cause.fold("none")(SafeLog.throwableClasses)
      val log = logger.error(
        s"event=worker_wake_sink_unavailable effects=$effects " +
          s"errorClasses=$errorClasses committedResultPreserved=true"
      )
      log.attempt.void >> onSinkClosed.handleErrorWith { error =>
        val escalationErrorClasses = SafeLog.throwableClasses(error)
        logger.error(
          s"event=worker_wake_sink_escalation_failed effects=$effects " +
            s"errorClasses=$escalationErrorClasses committedResultPreserved=true"
        )
      }.attempt.void

  private object WakeAfterCommit:
    def apply[F[_]: Async: LoggerFactory](
        sink: WorkerWakeSink[F],
        onSinkClosed: F[Unit],
    ): WakeAfterCommit[F] = new WakeAfterCommit(sink, onSinkClosed)

end WorkerWakingRepositories
