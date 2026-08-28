package momo.api.repositories

import java.time.Instant

import cats.{~>, MonadThrow}

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}
import momo.api.errors.AppError

trait MatchDraftsAlg[F0[_]]:
  def create(draft: MatchDraft): F0[Unit]
  def update(draft: MatchDraft, updatedAt: Instant): F0[MatchDraftUpdateResult]
  def find(id: MatchDraftId): F0[Option[MatchDraft]]
  def list(filter: MatchDraftsRepository.ListFilter): F0[List[MatchDraft]]
  def statsByHeldEvents(
      heldEventIds: List[HeldEventId]
  ): F0[Map[HeldEventId, MatchDraftsRepository.HeldEventStats]]
  def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F0[MatchDraftOcrFailureResult]
  def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F0[MatchDraftAttachmentResult]
  def markSourceImagesRetention(
      draftId: MatchDraftId,
      retainedUntil: Option[Instant],
      deletedAt: Option[Instant],
      updatedAt: Instant,
  ): F0[MatchDraftSourceImageRetentionResult]

/** Usecase-facing facade: expected create rejections are values; unexpected failures remain in F. */
trait MatchDraftsRepository[F[_]]:
  def create(draft: MatchDraft): F[Either[AppError, Unit]]
  def update(draft: MatchDraft, updatedAt: Instant): F[MatchDraftUpdateResult]
  def find(id: MatchDraftId): F[Option[MatchDraft]]
  def list(filter: MatchDraftsRepository.ListFilter): F[List[MatchDraft]]
  def statsByHeldEvents(
      heldEventIds: List[HeldEventId]
  ): F[Map[HeldEventId, MatchDraftsRepository.HeldEventStats]]
  def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[MatchDraftOcrFailureResult]
  def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F[MatchDraftAttachmentResult]
  def markSourceImagesRetention(
      draftId: MatchDraftId,
      retainedUntil: Option[Instant],
      deletedAt: Option[Instant],
      updatedAt: Instant,
  ): F[MatchDraftSourceImageRetentionResult]

enum MatchDraftUpdateResult derives CanEqual:
  case Updated
  case NotEditableOrChanged

enum MatchDraftOcrFailureResult derives CanEqual:
  case MarkedFailed
  case NotRunning

enum MatchDraftAttachmentResult derives CanEqual:
  case Attached
  case NotAttachable

enum MatchDraftSourceImageRetentionResult derives CanEqual:
  case Updated
  case NotFound

enum MatchDraftCancellationResult derives CanEqual:
  case Cancelled(sourceImageIds: List[ImageId])
  case NotFound
  case NotCancellable(status: MatchDraftStatus)

trait MatchDraftCancellationRepository[F[_]]:
  def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
  ): F[MatchDraftCancellationResult]

object MatchDraftsRepository:
  final case class HeldEventStats(draftCount: Int, maxMatchNo: Int)

  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      statuses: Set[MatchDraftStatus] = Set.empty,
      limit: Option[Int] = None,
  )

  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: MatchDraftsAlg[F0],
      liftK: F0 ~> F,
  ): MatchDraftsRepository[F] =
    new MatchDraftsRepository[F]:
      def create(draft: MatchDraft): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.create(draft)))
      def update(draft: MatchDraft, updatedAt: Instant): F[MatchDraftUpdateResult] =
        liftK(alg.update(draft, updatedAt))
      def find(id: MatchDraftId): F[Option[MatchDraft]] = liftK(alg.find(id))
      def list(filter: ListFilter): F[List[MatchDraft]] = liftK(alg.list(filter))
      def statsByHeldEvents(
          heldEventIds: List[HeldEventId]
      ): F[Map[HeldEventId, HeldEventStats]] = liftK(alg.statsByHeldEvents(heldEventIds))
      def markOcrFailed(
          draftId: MatchDraftId,
          updatedAt: Instant,
      ): F[MatchDraftOcrFailureResult] =
        liftK(alg.markOcrFailed(draftId, updatedAt))
      def attachOcrArtifacts(
          draftId: MatchDraftId,
          screenType: ScreenType,
          sourceImageId: ImageId,
          ocrDraftId: OcrDraftId,
          updatedAt: Instant,
      ): F[MatchDraftAttachmentResult] =
        liftK(alg.attachOcrArtifacts(draftId, screenType, sourceImageId, ocrDraftId, updatedAt))
      def markSourceImagesRetention(
          draftId: MatchDraftId,
          retainedUntil: Option[Instant],
          deletedAt: Option[Instant],
          updatedAt: Instant,
      ): F[MatchDraftSourceImageRetentionResult] =
        liftK(alg.markSourceImagesRetention(draftId, retainedUntil, deletedAt, updatedAt))

end MatchDraftsRepository
