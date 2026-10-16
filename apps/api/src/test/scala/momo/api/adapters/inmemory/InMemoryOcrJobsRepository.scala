package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchDraft,
  MatchDraftOcrSlot,
  MatchDraftOcrStatus,
  MatchDraftStatus,
  OcrJob,
  OcrJobInput,
  OcrJobStatus
}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  OcrJobAcceptance,
  OcrJobBacklogSnapshot,
  OcrJobCancellationResult,
  OcrJobsRepository
}

final class InMemoryOcrJobsRepository[F[_]: Sync] private (
    ref: Ref[F, InMemoryOcrJobsRepository.State],
    onQueuedCancel: (OcrJob.Cancelled, List[OcrJob]) => F[Unit],
    matchDrafts: Option[MatchDraftFixtureStore[F]],
) extends OcrJobsRepository[F]:
  override def findAcceptance(jobId: OcrJobId): F[Option[OcrJobAcceptance]] =
    find(jobId).map(_.map(OcrJobAcceptance.fromJob))

  def create(job: OcrJob): F[Unit] = createRecord(job, None)

  def createWithInput(job: OcrJob, input: OcrJobInput): F[Unit] = createRecord(job, Some(input))

  def inputs: F[Vector[OcrJobInput]] = ref.get.map(_.inputs.values.toVector.sortBy(_.jobId.value))

  private def createRecord(job: OcrJob, input: Option[OcrJobInput]): F[Unit] = ref.modify { current =>
    if current.jobs.contains(job.id.value) then
      current ->
        Left(new AppException(AppError.Conflict(s"ocr job already exists: ${job.id.value}")))
    else
      current.copy(
        jobs = current.jobs.updated(job.id.value, job),
        inputs = input.fold(current.inputs)(value => current.inputs.updated(job.id.value, value)),
      ) -> Right(())
  }.flatMap(_.liftTo[F])

  override def find(jobId: OcrJobId): F[Option[OcrJob]] = ref.get.map(_.jobs.get(jobId.value))

  override def countActive: F[Long] = ref.get
    .map(_.jobs.values.count(job => isActive(job.status)).toLong)

  override def backlogSnapshot(now: Instant): F[OcrJobBacklogSnapshot] = ref.get.map { state =>
    val queued = state.jobs.values.filter(_.status == OcrJobStatus.Queued).toList
    OcrJobBacklogSnapshot(
      queued.size.toLong,
      state.jobs.values.count(_.status == OcrJobStatus.Running).toLong,
      queued.map(_.createdAt).filterNot(_.isAfter(now)).minOption,
    )
  }

  def activeImageIds: F[Set[ImageId]] = ref.get
    .map(_.jobs.values.collect { case job if isActive(job.status) => job.imageId }.toSet)

  def existsActiveByDraft(draftId: OcrDraftId): F[Boolean] = ref.get
    .map(_.jobs.values.exists(job => job.draftId == draftId && isActive(job.status)))

  override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] = ref.modify { state =>
    val jobs = state.jobs
    jobs.get(jobId.value) match
      case Some(q: OcrJob.Queued) =>
        val cancelled = OcrJob.Cancelled(
          id = q.id,
          draftId = q.draftId,
          imageId = q.imageId,
          imageLocation = q.imageLocation,
          requestedScreenType = q.requestedScreenType,
          attemptCount = q.attemptCount,
          cancelledFinishedAt = now,
          createdAt = q.createdAt,
          updatedAt = now,
        )
        val updated = jobs.updated(jobId.value, cancelled)
        state.copy(jobs = updated) -> Some((cancelled, updated.values.toList))
      case _ => state -> None
  }.flatMap {
    case Some((cancelled, jobs)) => onQueuedCancel(cancelled, jobs).as(true)
    case None => false.pure[F]
  }

  override def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F[Int] =
    val ids = draftIds.toSet
    ref.modify { state =>
      val jobs = state.jobs
      val (updated, cancelled) = jobs.foldLeft((jobs, List.empty[OcrJob.Cancelled])) {
        case ((acc, cancelledAcc), (jobId, q: OcrJob.Queued)) if ids.contains(q.draftId) =>
          val cancelled = OcrJob.Cancelled(
            id = q.id,
            draftId = q.draftId,
            imageId = q.imageId,
            imageLocation = q.imageLocation,
            requestedScreenType = q.requestedScreenType,
            attemptCount = q.attemptCount,
            cancelledFinishedAt = now,
            createdAt = q.createdAt,
            updatedAt = now,
          )
          (acc.updated(jobId, cancelled), cancelled :: cancelledAcc)
        case ((acc, cancelledAcc), _) => (acc, cancelledAcc)
      }
      state.copy(jobs = updated) -> (cancelled.reverse, updated.values.toList)
    }.flatMap { case (cancelled, jobs) =>
      cancelled.traverse_(job => onQueuedCancel(job, jobs)).as(cancelled.size)
    }

  override def cancelQueuedOwned(
      jobId: OcrJobId,
      owner: AccountId,
      now: Instant,
  ): F[OcrJobCancellationResult] = find(jobId).flatMap {
    case None => OcrJobCancellationResult.NotFound.pure[F]
    case Some(job) =>
      matchDrafts.traverse(_.list(MatchDraftFixtureStore.ListFilter())).map(_.toList.flatten.exists(
        draft => draft.createdByAccountId == owner && draft.ocrDraftIds.contains(job.draftId)
      )).flatMap {
        case false => OcrJobCancellationResult.Forbidden.pure[F]
        case true => cancelQueued(jobId, now).map {
            case true => OcrJobCancellationResult.Cancelled
            case false => OcrJobCancellationResult.NotQueued
          }
      }
  }

  private def isActive(status: OcrJobStatus): Boolean = status == OcrJobStatus.Queued ||
    status == OcrJobStatus.Running

object InMemoryOcrJobsRepository:
  private final case class State(
      jobs: Map[String, OcrJob],
      inputs: Map[String, OcrJobInput],
  )
  private val empty = State(Map.empty, Map.empty)

  def create[F[_]: Sync]: F[InMemoryOcrJobsRepository[F]] = Ref
    .of[F, State](empty)
    .map(new InMemoryOcrJobsRepository(_, (_, _) => Sync[F].unit, None))

  def createWithDraftCancelSync[F[_]: Sync](
      matchDrafts: MatchDraftFixtureStore[F]
  ): F[InMemoryOcrJobsRepository[F]] = Ref.of[F, State](empty)
    .map(new InMemoryOcrJobsRepository(
      _,
      syncCancelledOcrJob(matchDrafts, _, _),
      Some(matchDrafts)
    ))

  private def syncCancelledOcrJob[F[_]: Sync](
      matchDrafts: MatchDraftFixtureStore[F],
      cancelled: OcrJob.Cancelled,
      jobs: List[OcrJob],
  ): F[Unit] = matchDrafts.list(MatchDraftFixtureStore.ListFilter()).flatMap { drafts =>
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
