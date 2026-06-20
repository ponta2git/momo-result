package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}

trait MatchDraftsAlg[F0[_]]:
  def create(draft: MatchDraft): F0[Unit]
  def update(draft: MatchDraft, updatedAt: Instant): F0[Boolean]
  def find(id: MatchDraftId): F0[Option[MatchDraft]]
  def list(filter: MatchDraftsRepository.ListFilter): F0[List[MatchDraft]]
  def markConfirmed(
      draftId: MatchDraftId,
      confirmedMatchId: MatchId,
      updatedAt: Instant,
  ): F0[Boolean]
  def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F0[Boolean]

  /** Physically remove a non-terminal draft when the user discards it. */
  def cancel(draftId: MatchDraftId, updatedAt: Instant): F0[Boolean]
  def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F0[Boolean]
  def markSourceImagesRetention(
      draftId: MatchDraftId,
      retainedUntil: Option[Instant],
      deletedAt: Option[Instant],
      updatedAt: Instant,
  ): F0[Boolean]

trait MatchDraftsRepository[F[_]]:
  def create(draft: MatchDraft): F[Unit]
  def update(draft: MatchDraft, updatedAt: Instant): F[Boolean]
  def find(id: MatchDraftId): F[Option[MatchDraft]]
  def list(filter: MatchDraftsRepository.ListFilter): F[List[MatchDraft]]
  def markConfirmed(
      draftId: MatchDraftId,
      confirmedMatchId: MatchId,
      updatedAt: Instant,
  ): F[Boolean]
  def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean]

  /** Physically remove a non-terminal draft when the user discards it. */
  def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean]
  def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F[Boolean]
  def markSourceImagesRetention(
      draftId: MatchDraftId,
      retainedUntil: Option[Instant],
      deletedAt: Option[Instant],
      updatedAt: Instant,
  ): F[Boolean]

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
  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      statuses: Set[MatchDraftStatus] = Set.empty,
      limit: Option[Int] = None,
  )

  def fromAlg[F0[_], F[_]](alg: MatchDraftsAlg[F0], liftK: F0 ~> F): MatchDraftsRepository[F] =
    new MatchDraftsRepository[F]:
      def create(draft: MatchDraft): F[Unit] = liftK(alg.create(draft))
      def update(draft: MatchDraft, updatedAt: Instant): F[Boolean] =
        liftK(alg.update(draft, updatedAt))
      def find(id: MatchDraftId): F[Option[MatchDraft]] = liftK(alg.find(id))
      def list(filter: ListFilter): F[List[MatchDraft]] = liftK(alg.list(filter))
      def markConfirmed(
          draftId: MatchDraftId,
          confirmedMatchId: MatchId,
          updatedAt: Instant,
      ): F[Boolean] = liftK(alg.markConfirmed(draftId, confirmedMatchId, updatedAt))
      def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] =
        liftK(alg.markOcrFailed(draftId, updatedAt))
      def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] =
        liftK(alg.cancel(draftId, updatedAt))
      def attachOcrArtifacts(
          draftId: MatchDraftId,
          screenType: ScreenType,
          sourceImageId: ImageId,
          ocrDraftId: OcrDraftId,
          updatedAt: Instant,
      ): F[Boolean] =
        liftK(alg.attachOcrArtifacts(draftId, screenType, sourceImageId, ocrDraftId, updatedAt))
      def markSourceImagesRetention(
          draftId: MatchDraftId,
          retainedUntil: Option[Instant],
          deletedAt: Option[Instant],
          updatedAt: Instant,
      ): F[Boolean] =
        liftK(alg.markSourceImagesRetention(draftId, retainedUntil, deletedAt, updatedAt))

  def liftIdentity[F[_]](alg: MatchDraftsAlg[F]): MatchDraftsRepository[F] =
    new MatchDraftsRepository[F]:
      export alg.*
end MatchDraftsRepository
