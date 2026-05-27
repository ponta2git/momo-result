package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchDraft, MatchDraftOcrSlot, MatchDraftOcrStatus, MatchDraftStatus, OcrFailure, OcrJob,
  OcrJobStatus,
}
import momo.api.repositories.{MatchDraftsRepository, OcrJobsRepository}

final class InMemoryOcrJobsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[String, OcrJob]],
    onQueuedCancel: (OcrJob.Cancelled, List[OcrJob]) => F[Unit],
) extends OcrJobsRepository[F]:
  override def create(job: OcrJob): F[Unit] = ref.update(_ + (job.id.value -> job))

  override def find(jobId: OcrJobId): F[Option[OcrJob]] = ref.get.map(_.get(jobId.value))

  override def countActive: F[Long] = ref.get
    .map(_.values.count(job => isActive(job.status)).toLong)

  def existsActiveByDraft(draftId: OcrDraftId): F[Boolean] = ref.get
    .map(_.values.exists(job => job.draftId == draftId && isActive(job.status)))

  override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] = ref
    .update(jobs => jobs.updatedWith(jobId.value)(_.map(toFailed(_, failure, now))))

  override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] = ref.modify { jobs =>
    jobs.get(jobId.value) match
      case Some(q: OcrJob.Queued) =>
        val cancelled = OcrJob.Cancelled(
          id = q.id,
          draftId = q.draftId,
          imageId = q.imageId,
          imagePath = q.imagePath,
          requestedScreenType = q.requestedScreenType,
          attemptCount = q.attemptCount,
          cancelledFinishedAt = now,
          createdAt = q.createdAt,
          updatedAt = now,
        )
        val updated = jobs.updated(jobId.value, cancelled)
        updated -> Some((cancelled, updated.values.toList))
      case _ => jobs -> None
  }.flatMap {
    case Some((cancelled, jobs)) => onQueuedCancel(cancelled, jobs).as(true)
    case None => false.pure[F]
  }

  override def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F[Int] =
    val ids = draftIds.toSet
    ref.modify { jobs =>
      val (updated, cancelled) = jobs.foldLeft((jobs, List.empty[OcrJob.Cancelled])) {
        case ((acc, cancelledAcc), (jobId, q: OcrJob.Queued)) if ids.contains(q.draftId) =>
          val cancelled = OcrJob.Cancelled(
            id = q.id,
            draftId = q.draftId,
            imageId = q.imageId,
            imagePath = q.imagePath,
            requestedScreenType = q.requestedScreenType,
            attemptCount = q.attemptCount,
            cancelledFinishedAt = now,
            createdAt = q.createdAt,
            updatedAt = now,
          )
          (acc.updated(jobId, cancelled), cancelled :: cancelledAcc)
        case ((acc, cancelledAcc), _) => (acc, cancelledAcc)
      }
      updated -> (cancelled.reverse, updated.values.toList)
    }.flatMap { case (cancelled, jobs) =>
      cancelled.traverse_(job => onQueuedCancel(job, jobs)).as(cancelled.size)
    }

  private def toFailed(job: OcrJob, failure: OcrFailure, now: Instant): OcrJob.Failed = OcrJob
    .Failed(
      id = job.id,
      draftId = job.draftId,
      imageId = job.imageId,
      imagePath = job.imagePath,
      requestedScreenType = job.requestedScreenType,
      failedDetectedScreenType = OcrJob.detectedScreenType(job),
      attemptCount = job.attemptCount,
      failedWorkerId = OcrJob.workerId(job),
      failedFailure = failure,
      failedStartedAt = OcrJob.startedAt(job),
      failedFinishedAt = now,
      failedDurationMs = OcrJob.durationMs(job),
      createdAt = job.createdAt,
      updatedAt = now,
    )

  private def isActive(status: OcrJobStatus): Boolean = status == OcrJobStatus.Queued ||
    status == OcrJobStatus.Running

object InMemoryOcrJobsRepository:
  def create[F[_]: Sync]: F[InMemoryOcrJobsRepository[F]] = Ref
    .of[F, Map[String, OcrJob]](Map.empty)
    .map(new InMemoryOcrJobsRepository(_, (_, _) => Sync[F].unit))

  def createWithCancelSync[F[_]: Sync](
      onQueuedCancel: (OcrJob.Cancelled, List[OcrJob]) => F[Unit]
  ): F[InMemoryOcrJobsRepository[F]] = Ref.of[F, Map[String, OcrJob]](Map.empty)
    .map(new InMemoryOcrJobsRepository(_, onQueuedCancel))

  def createWithDraftCancelSync[F[_]: Sync](
      matchDrafts: MatchDraftsRepository[F]
  ): F[InMemoryOcrJobsRepository[F]] = createWithCancelSync(syncCancelledOcrJob(matchDrafts, _, _))

  private def syncCancelledOcrJob[F[_]: Sync](
      matchDrafts: MatchDraftsRepository[F],
      cancelled: OcrJob.Cancelled,
      jobs: List[OcrJob],
  ): F[Unit] = matchDrafts.list(MatchDraftsRepository.ListFilter()).flatMap { drafts =>
    drafts.find(draft => draftOcrDraftIds(draft).contains(cancelled.draftId)) match
      case Some(draft) if draft.status == MatchDraftStatus.OcrRunning =>
        val slotDraftIds = draftOcrDraftIds(draft)
        val slots = slotDraftIds.toList.map { draftId =>
          MatchDraftOcrSlot(
            jobStatus = jobs.find(_.draftId == draftId).map(_.status),
            hasWarnings = false,
          )
        }
        MatchDraftOcrStatus.project(draft.status, slots) match
          case MatchDraftStatus.OcrFailed => matchDrafts
              .markOcrFailed(draft.id, cancelled.updatedAt).void
          case _ => Sync[F].unit
      case _ => Sync[F].unit
  }

  private def draftOcrDraftIds(draft: MatchDraft): Set[OcrDraftId] = draft.ocrDraftIds.toSet
