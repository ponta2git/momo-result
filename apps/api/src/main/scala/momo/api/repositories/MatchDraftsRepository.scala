package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}

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
