package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

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

object MatchDraftsRepository:
  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      statuses: Set[MatchDraftStatus] = Set.empty,
      limit: Option[Int] = None,
  )

  def fromConnectionIO[F[_]](
      alg: MatchDraftsAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MatchDraftsRepository[F] = new MatchDraftsRepository[F]:
    def create(draft: MatchDraft): F[Unit] = transactK(alg.create(draft))
    def update(draft: MatchDraft, updatedAt: Instant): F[Boolean] =
      transactK(alg.update(draft, updatedAt))
    def find(id: MatchDraftId): F[Option[MatchDraft]] = transactK(alg.find(id))
    def list(filter: ListFilter): F[List[MatchDraft]] = transactK(alg.list(filter))
    def markConfirmed(
        draftId: MatchDraftId,
        confirmedMatchId: MatchId,
        updatedAt: Instant,
    ): F[Boolean] = transactK(alg.markConfirmed(draftId, confirmedMatchId, updatedAt))
    def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] =
      transactK(alg.markOcrFailed(draftId, updatedAt))
    def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] =
      transactK(alg.cancel(draftId, updatedAt))
    def attachOcrArtifacts(
        draftId: MatchDraftId,
        screenType: ScreenType,
        sourceImageId: ImageId,
        ocrDraftId: OcrDraftId,
        updatedAt: Instant,
    ): F[Boolean] =
      transactK(alg.attachOcrArtifacts(draftId, screenType, sourceImageId, ocrDraftId, updatedAt))
    def markSourceImagesRetention(
        draftId: MatchDraftId,
        retainedUntil: Option[Instant],
        deletedAt: Option[Instant],
        updatedAt: Instant,
    ): F[Boolean] =
      transactK(alg.markSourceImagesRetention(draftId, retainedUntil, deletedAt, updatedAt))

  def liftIdentity[F[_]](alg: MatchDraftsAlg[F]): MatchDraftsRepository[F] =
    new MatchDraftsRepository[F]:
      def create(draft: MatchDraft): F[Unit] = alg.create(draft)
      def update(draft: MatchDraft, updatedAt: Instant): F[Boolean] = alg.update(draft, updatedAt)
      def find(id: MatchDraftId): F[Option[MatchDraft]] = alg.find(id)
      def list(filter: ListFilter): F[List[MatchDraft]] = alg.list(filter)
      def markConfirmed(
          draftId: MatchDraftId,
          confirmedMatchId: MatchId,
          updatedAt: Instant,
      ): F[Boolean] = alg.markConfirmed(draftId, confirmedMatchId, updatedAt)
      def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = alg
        .markOcrFailed(draftId, updatedAt)
      def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = alg
        .cancel(draftId, updatedAt)
      def attachOcrArtifacts(
          draftId: MatchDraftId,
          screenType: ScreenType,
          sourceImageId: ImageId,
          ocrDraftId: OcrDraftId,
          updatedAt: Instant,
      ): F[Boolean] = alg
        .attachOcrArtifacts(draftId, screenType, sourceImageId, ocrDraftId, updatedAt)
      def markSourceImagesRetention(
          draftId: MatchDraftId,
          retainedUntil: Option[Instant],
          deletedAt: Option[Instant],
          updatedAt: Instant,
      ): F[Boolean] = alg.markSourceImagesRetention(draftId, retainedUntil, deletedAt, updatedAt)
end MatchDraftsRepository
