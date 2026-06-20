package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}
import momo.api.repositories.MatchDraftsRepository

final class InMemoryMatchDraftsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[MatchDraftId, MatchDraft]]
) extends MatchDraftsRepository[F]:
  override def create(draft: MatchDraft): F[Unit] = ref.update(_ + (draft.id -> draft))

  override def update(draft: MatchDraft, updatedAt: Instant): F[Boolean] = ref.modify { current =>
    (current.get(draft.id), draft) match
      case (Some(existing: MatchDraft.Editable), _: MatchDraft.Editable)
          if canApplyUserUpdate(existing, draft) =>
        val next = draft.withCommon(_.copy(updatedAt = updatedAt))
        (current + (draft.id -> next), true)
      case _ => (current, false)
  }

  override def find(id: MatchDraftId): F[Option[MatchDraft]] = ref.get.map(_.get(id))

  override def list(filter: MatchDraftsRepository.ListFilter): F[List[MatchDraft]] = ref.get
    .map { all =>
      val filtered = all.values.filter { draft =>
        filter.heldEventId.forall(v => draft.heldEventId.contains(v)) &&
        filter.gameTitleId.forall(v => draft.gameTitleId.contains(v)) &&
        filter.seasonMasterId.forall(v => draft.seasonMasterId.contains(v)) &&
        (filter.statuses.isEmpty || filter.statuses.contains(draft.status))
      }.toList.sortBy(d => (-d.updatedAt.toEpochMilli, -d.createdAt.toEpochMilli))
      filter.limit.fold(filtered)(filtered.take)
    }

  override def markConfirmed(
      draftId: MatchDraftId,
      confirmedMatchId: MatchId,
      updatedAt: Instant,
  ): F[Boolean] = ref.modify { current =>
    current.get(draftId) match
      case Some(e: MatchDraft.Editable) =>
        val next = MatchDraft.Confirmed(
          common = e.common.copy(updatedAt = updatedAt),
          confirmedMatchIdValue = confirmedMatchId,
        )
        (current + (draftId -> next), true)
      case _ => (current, false)
  }

  override def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = ref
    .modify { current =>
      current.get(draftId) match
        case Some(e: MatchDraft.OcrRunning) =>
          val next = MatchDraft.OcrFailed(e.common.copy(updatedAt = updatedAt))
          (current + (draftId -> next), true)
        case _ => (current, false)
    }

  override def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = ref.modify { current =>
    current.get(draftId) match
      case Some(_: MatchDraft.Editable) => (current - draftId, true)
      case _ => (current, false)
  }

  override def attachOcrArtifacts(
      draftId: MatchDraftId,
      screenType: ScreenType,
      sourceImageId: ImageId,
      ocrDraftId: OcrDraftId,
      updatedAt: Instant,
  ): F[Boolean] = ref.modify { current =>
    current.get(draftId) match
      case Some(e: MatchDraft.Editable) if canAttachScreenType(screenType) =>
        val withArtifacts = screenType match
          case ScreenType.TotalAssets => e.common
              .copy(totalAssetsImageId = Some(sourceImageId), totalAssetsDraftId = Some(ocrDraftId))
          case ScreenType.Revenue => e.common
              .copy(revenueImageId = Some(sourceImageId), revenueDraftId = Some(ocrDraftId))
          case ScreenType.IncidentLog => e.common
              .copy(incidentLogImageId = Some(sourceImageId), incidentLogDraftId = Some(ocrDraftId))
          case ScreenType.Auto => e.common
        val next = MatchDraft
          .OcrRunning(withArtifacts.copy(updatedAt = updatedAt, sourceImagesDeletedAt = None))
        (current + (draftId -> next), true)
      case _ => (current, false)
  }

  override def markSourceImagesRetention(
      draftId: MatchDraftId,
      retainedUntil: Option[Instant],
      deletedAt: Option[Instant],
      updatedAt: Instant,
  ): F[Boolean] = ref.modify { current =>
    current.get(draftId) match
      case None => (current, false)
      case Some(draft) =>
        val next = draft.withCommon(_.copy(
          sourceImagesRetainedUntil = retainedUntil,
          sourceImagesDeletedAt = deletedAt,
          updatedAt = updatedAt,
        ))
        (current + (draftId -> next), true)
  }

  def deleteDiscardedByGameTitle(gameTitleId: GameTitleId): F[Int] =
    deleteDiscarded(draft => draft.gameTitleId.contains(gameTitleId))

  def deleteDiscardedByMapMaster(mapMasterId: MapMasterId): F[Int] =
    deleteDiscarded(draft => draft.mapMasterId.contains(mapMasterId))

  def deleteDiscardedBySeasonMaster(seasonMasterId: SeasonMasterId): F[Int] =
    deleteDiscarded(draft => draft.seasonMasterId.contains(seasonMasterId))

  def existsBlockingReferenceToGameTitle(gameTitleId: GameTitleId): F[Boolean] =
    existsBlockingReference(_.gameTitleId.contains(gameTitleId))

  def existsBlockingReferenceToMapMaster(mapMasterId: MapMasterId): F[Boolean] =
    existsBlockingReference(_.mapMasterId.contains(mapMasterId))

  def existsBlockingReferenceToSeasonMaster(seasonMasterId: SeasonMasterId): F[Boolean] =
    existsBlockingReference(_.seasonMasterId.contains(seasonMasterId))

  private def canAttachScreenType(screenType: ScreenType): Boolean = screenType != ScreenType.Auto

  private def canApplyUserUpdate(existing: MatchDraft.Editable, draft: MatchDraft): Boolean =
    MatchDraftStatus.userEditableStatuses.contains(existing.status) &&
      MatchDraftStatus.userEditableStatuses.contains(draft.status) &&
      existing.updatedAt.equals(draft.updatedAt)

  private def deleteDiscarded(matchesScope: MatchDraft => Boolean): F[Int] = ref.modify { current =>
    val discarded = current
      .collect { case (id, draft) if matchesScope(draft) && isDiscarded(draft) => id }.toSet
    (current -- discarded, discarded.size)
  }

  private def existsBlockingReference(matchesScope: MatchDraft => Boolean): F[Boolean] = ref.get
    .map(_.values.exists(draft => matchesScope(draft) && !isDiscarded(draft)))

  private def isDiscarded(draft: MatchDraft): Boolean =
    draft.status == MatchDraftStatus.Cancelled ||
      (draft.status == MatchDraftStatus.Confirmed && draft.confirmedMatchId.isEmpty)

object InMemoryMatchDraftsRepository:
  def create[F[_]: Sync]: F[InMemoryMatchDraftsRepository[F]] = Ref
    .of[F, Map[MatchDraftId, MatchDraft]](Map.empty).map(new InMemoryMatchDraftsRepository(_))
