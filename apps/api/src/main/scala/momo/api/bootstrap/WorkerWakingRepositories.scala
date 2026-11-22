package momo.api.bootstrap

import java.time.Instant
import java.util.UUID

import cats.effect.Async
import cats.effect.syntax.all.*
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.*
import momo.api.usecases.queue.WorkerWakeSink

/** Signals committed transitions and requests recovery if the commit could not be observed. */
private[bootstrap] object WorkerWakingRepositories:
  def mapMasters[F[_]: Async: LoggerFactory](
      delegate: MapMastersRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): MapMastersRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new MapMastersRepository[F]:
      export delegate.{list, find, update}
      def createWithNextDisplayOrder(map: MapMaster): F[Either[AppError, MapMaster]] =
        wake(delegate.createWithNextDisplayOrder(map))(_.isRight)
      def delete(id: MapMasterId): F[Either[AppError, Unit]] =
        wake(delegate.delete(id))(_.isRight)

  def achievements[F[_]: Async: LoggerFactory](
      delegate: AchievementsRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): AchievementsRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new AchievementsRepository[F]:
      export delegate.{catalog, reorder}
      def create(
          command: CreateAchievement,
          context: AchievementMutationContext
      ): F[Either[AppError, AchievementItem]] =
        wake(delegate.create(command, context))(_.isRight)
      def update(
          id: UUID,
          command: UpdateAchievement,
          context: AchievementMutationContext
      ): F[Either[AppError, AchievementItem]] =
        wake(delegate.update(id, command, context))(_.isRight)
      def retire(
          id: UUID,
          version: Long,
          context: AchievementMutationContext
      ): F[Either[AppError, AchievementItem]] =
        wake(delegate.retire(id, version, context))(_.isRight)
      def correctClaim(
          id: UUID,
          command: CorrectAchievementClaim,
          context: AchievementMutationContext
      ): F[Either[AppError, AchievementClaim]] =
        wake(delegate.correctClaim(id, command, context))(_.isRight)
      def addToMatch(
          id: MatchId,
          command: AddMatchAchievements,
          context: AchievementMutationContext
      ): F[Either[AppError, Unit]] =
        wake(delegate.addToMatch(id, command, context))(_.isRight)

  def ocrJobCreation[F[_]: Async: LoggerFactory](
      delegate: OcrJobCreationStore[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): OcrJobCreationStore[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new OcrJobCreationStore[F]:
      override def store(
          plan: OcrJobCreationPlan
      ): F[OcrJobCreationStore.OcrJobCreationResult] = wake(
        delegate.store(plan),
      )(_.exists(_.created))

  def ocrSubmissions[F[_]: Async: LoggerFactory](
      delegate: OcrSubmissionsRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): OcrSubmissionsRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new OcrSubmissionsRepository[F]:
      export delegate.find

      override def put(submission: OcrSubmission): F[Either[AppError, OcrSubmission]] =
        wake(delegate.put(submission))(_.isRight)

      override def failAdmission(
          owner: AccountId,
          keyHash: String,
          sha256: String,
          byteLength: Int,
      ): F[Unit] = wake(
        delegate.failAdmission(owner, keyHash, sha256, byteLength),
      )(_ => true)

  def ocrJobs[F[_]: Async: LoggerFactory](
      delegate: OcrJobsRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): OcrJobsRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new OcrJobsRepository[F]:
      export delegate.{find, findAcceptance, countActive, backlogSnapshot}

      override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] =
        wake(delegate.cancelQueued(jobId, now))(identity)

      override def cancelQueuedOwned(
          jobId: OcrJobId,
          owner: AccountId,
          now: Instant
      ): F[OcrJobCancellationResult] =
        wake(delegate.cancelQueuedOwned(jobId, owner, now))(
          _ == OcrJobCancellationResult.Cancelled
        )

      override def cancelQueuedByDraftIds(ids: List[OcrDraftId], now: Instant): F[Int] =
        wake(delegate.cancelQueuedByDraftIds(ids, now))(_ > 0)

  def matchDraftCancellation[F[_]: Async: LoggerFactory](
      delegate: MatchDraftCancellationRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): MatchDraftCancellationRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new MatchDraftCancellationRepository[F]:
      def cancelDraftAndQueuedOcrJobs(id: MatchDraftId, now: Instant, owner: AccountId)
          : F[MatchDraftCancellationResult] =
        wake(delegate.cancelDraftAndQueuedOcrJobs(id, now, owner))(_ ==
          MatchDraftCancellationResult.Cancelled)

  def matches[F[_]: Async: LoggerFactory](
      delegate: MatchesRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): MatchesRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new MatchesRepository[F]:
      override def update(
          id: MatchId,
          change: MatchUpdate,
          updatedAt: Instant,
      ): F[Either[AppError, MatchRecord]] = wake(
        delegate.update(id, change, updatedAt),
      )(_.isRight)

      override def delete(id: MatchId, actor: Option[AccountId]): F[Boolean] = wake(
        delegate.delete(id, actor),
      )(identity)

      override def find(id: MatchId): F[Option[MatchRecord]] = delegate.find(id)

      override def existsMatchNo(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
      ): F[Boolean] = delegate.existsMatchNo(heldEventId, matchNoInEvent)

      override def existsMatchNoExcept(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
          excludeMatchId: MatchId,
      ): F[Boolean] = delegate.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId)

  def matchConfirmation[F[_]: Async: LoggerFactory](
      delegate: MatchConfirmationRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): MatchConfirmationRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
    new MatchConfirmationRepository[F]:
      override def confirm(
          record: MatchRecord,
          draft: Option[MatchDraftConfirmation],
          updatedAt: Instant,
          achievements: List[AddMatchAchievement],
      ): F[Either[AppError, MatchConfirmationResult]] = wake(
        delegate.confirm(record, draft, updatedAt, achievements),
      )(_.contains(MatchConfirmationResult.Confirmed))

  def seriesAnalysis[F[_]: Async: LoggerFactory](
      delegate: SeriesAnalysisRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): SeriesAnalysisRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
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
      )(_.isRight)

      override def requestAllRecalculation(
          requestedBy: AccountId,
          idempotencyKeyHash: String,
      ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = wake(
        delegate.requestAllRecalculation(requestedBy, idempotencyKeyHash),
      )(_.isRight)

  def seriesPlayerRadar[F[_]: Async: LoggerFactory](
      delegate: SeriesPlayerRadarRepository[F],
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ): SeriesPlayerRadarRepository[F] =
    val wake = WakeAfterCommit(sink, onSinkFailure)
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
      )(_.isRight)

  private final class WakeAfterCommit[F[_]: Async: LoggerFactory](
      sink: WorkerWakeSink[F],
      onSinkFailure: F[Unit],
  ):
    private val logger = LoggerFactory[F].getLoggerFromName(
      "momo.api.bootstrap.WorkerWakingRepositories"
    )

    def apply[A](operation: F[A])(shouldWake: A => Boolean): F[A] =
      Async[F].uncancelable { poll =>
        // Cancellation or a lost COMMIT response can leave durable work behind. Preserve the
        // caller's outcome and change the epoch to cover a commit that lands after the first scan.
        poll(operation).onCancel(report(sink.uncertain)).onError { case _ =>
          report(sink.uncertain)
        }
          .flatTap(result => report(sink.signal).whenA(shouldWake(result)))
      }

    private def report(hint: F[Unit]): F[Unit] = hint.handleErrorWith { error =>
      logger.error(s"event=worker_wake_unavailable errorClasses=${SafeLog.throwableClasses(error)}")
        .attempt.void *> onSinkFailure.attempt.void
    }

  private object WakeAfterCommit:
    def apply[F[_]: Async: LoggerFactory](
        sink: WorkerWakeSink[F],
        onSinkFailure: F[Unit],
    ): WakeAfterCommit[F] = new WakeAfterCommit(sink, onSinkFailure)

end WorkerWakingRepositories
