package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.ids.{AccountId, ImageId, OcrDraftId, OcrJobId}
import momo.api.domain.{OcrJob, OcrJobStatus}

/** Receipt returned for a new job or an accepted submission member's replay. */
final case class OcrJobAcceptance(
    id: OcrJobId,
    draftId: OcrDraftId,
    imageId: ImageId,
    status: OcrJobStatus,
)

object OcrJobAcceptance:
  def fromJob(job: OcrJob): OcrJobAcceptance =
    OcrJobAcceptance(job.id, job.draftId, job.imageId, job.status)

final case class OcrJobBacklogSnapshot(
    queuedCount: Long,
    runningCount: Long,
    oldestReadyAt: Option[Instant],
) derives CanEqual:
  def activeCount: Long = queuedCount + runningCount

trait OcrJobsAlg[F0[_]]:
  def find(jobId: OcrJobId): F0[Option[OcrJob]]
  def findAcceptance(jobId: OcrJobId): F0[Option[OcrJobAcceptance]]
  def countActive: F0[Long]
  def backlogSnapshot(now: Instant): F0[OcrJobBacklogSnapshot]
  def cancelQueued(jobId: OcrJobId, now: Instant): F0[Boolean]
  def cancelQueuedOwned(
      jobId: OcrJobId,
      owner: AccountId,
      now: Instant
  ): F0[OcrJobCancellationResult]
  def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F0[Int]

trait OcrJobsRepository[F[_]] extends OcrJobsAlg[F]

enum OcrJobCancellationResult derives CanEqual:
  case Cancelled, NotFound, Forbidden, NotQueued

object OcrJobsRepository:
  def fromAlg[F0[_], F[_]](alg: OcrJobsAlg[F0], liftK: F0 ~> F): OcrJobsRepository[F] =
    new OcrJobsRepository[F]:
      def find(jobId: OcrJobId): F[Option[OcrJob]] = liftK(alg.find(jobId))
      def findAcceptance(jobId: OcrJobId): F[Option[OcrJobAcceptance]] =
        liftK(alg.findAcceptance(jobId))
      def countActive: F[Long] = liftK(alg.countActive)
      def backlogSnapshot(now: Instant): F[OcrJobBacklogSnapshot] = liftK(alg.backlogSnapshot(now))
      def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] =
        liftK(alg.cancelQueued(jobId, now))
      def cancelQueuedOwned(
          jobId: OcrJobId,
          owner: AccountId,
          now: Instant
      ): F[OcrJobCancellationResult] =
        liftK(alg.cancelQueuedOwned(jobId, owner, now))
      def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F[Int] =
        liftK(alg.cancelQueuedByDraftIds(draftIds, now))

end OcrJobsRepository
