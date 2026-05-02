package momo.api.repositories

import java.time.Instant
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}

trait MatchDraftsRepository[F[_]]:
  def create(draft: MatchDraft): F[Unit]
  def update(draft: MatchDraft, updatedAt: Instant): F[Boolean]
  def find(id: String): F[Option[MatchDraft]]
  def list(filter: MatchDraftsRepository.ListFilter): F[List[MatchDraft]]
  def markConfirmed(draftId: String, confirmedMatchId: String, updatedAt: Instant): F[Boolean]
  def markOcrFailed(draftId: String, updatedAt: Instant): F[Boolean]
  def cancel(draftId: String, updatedAt: Instant): F[Boolean]
  def attachOcrArtifacts(
      draftId: String,
      screenType: ScreenType,
      sourceImageId: String,
      ocrDraftId: String,
      updatedAt: Instant,
  ): F[Boolean]
  def markSourceImagesRetention(
      draftId: String,
      retainedUntil: Option[Instant],
      deletedAt: Option[Instant],
      updatedAt: Instant,
  ): F[Boolean]

object MatchDraftsRepository:
  final case class ListFilter(
      heldEventId: Option[String] = None,
      gameTitleId: Option[String] = None,
      seasonMasterId: Option[String] = None,
      statuses: Set[MatchDraftStatus] = Set.empty,
      limit: Option[Int] = None,
  )
