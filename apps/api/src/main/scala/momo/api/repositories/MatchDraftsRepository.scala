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
  def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F0[MatchDraftOcrFailureResult]
  def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F0[MatchDraftAttachmentResult]

/** Usecase-facing facade: expected create rejections are values; unexpected failures remain in F. */
trait MatchDraftsRepository[F[_]]:
  def create(draft: MatchDraft): F[Either[AppError, Unit]]
  def update(draft: MatchDraft, updatedAt: Instant): F[MatchDraftUpdateResult]
  def find(id: MatchDraftId): F[Option[MatchDraft]]
  def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[MatchDraftOcrFailureResult]
  def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F[MatchDraftAttachmentResult]

enum MatchDraftUpdateResult derives CanEqual:
  case Updated
  case NotEditableOrChanged
  case PrerequisitesChanged

enum MatchDraftOcrFailureResult derives CanEqual:
  case MarkedFailed
  case NotRunning

enum MatchDraftAttachmentResult derives CanEqual:
  case Attached
  case NotAttachable

enum MatchDraftCancellationResult derives CanEqual:
  case Cancelled
  case NotFound
  case Forbidden
  case NotCancellable(status: MatchDraftStatus)

trait MatchDraftCancellationRepository[F[_]]:
  def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
      actorAccountId: AccountId,
  ): F[MatchDraftCancellationResult]

object MatchDraftsRepository:
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

end MatchDraftsRepository
