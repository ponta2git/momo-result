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
    current.get(draft.id) match
      case None => (current, false)
      case Some(_) =>
        val next = withUpdatedAt(draft, updatedAt)
        (current + (draft.id -> next), true)
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
      case Some(e: MatchDraft.Editing) =>
        val next = MatchDraft.Confirmed(
          id = e.id,
          createdByMemberId = e.createdByMemberId,
          heldEventId = e.heldEventId,
          matchNoInEvent = e.matchNoInEvent,
          gameTitleId = e.gameTitleId,
          layoutFamily = e.layoutFamily,
          seasonMasterId = e.seasonMasterId,
          ownerMemberId = e.ownerMemberId,
          mapMasterId = e.mapMasterId,
          playedAt = e.playedAt,
          totalAssetsImageId = e.totalAssetsImageId,
          revenueImageId = e.revenueImageId,
          incidentLogImageId = e.incidentLogImageId,
          totalAssetsDraftId = e.totalAssetsDraftId,
          revenueDraftId = e.revenueDraftId,
          incidentLogDraftId = e.incidentLogDraftId,
          sourceImagesRetainedUntil = e.sourceImagesRetainedUntil,
          sourceImagesDeletedAt = e.sourceImagesDeletedAt,
          confirmedMatchIdValue = confirmedMatchId,
          createdAt = e.createdAt,
          updatedAt = updatedAt,
        )
        (current + (draftId -> next), true)
      case _ => (current, false)
  }

  override def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = ref
    .modify { current =>
      current.get(draftId) match
        case Some(e: MatchDraft.Editing) =>
          val next = e.copy(status = MatchDraftStatus.OcrFailed, updatedAt = updatedAt)
          (current + (draftId -> next), true)
        case _ => (current, false)
    }

  override def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = ref.modify { current =>
    current.get(draftId) match
      case Some(e: MatchDraft.Editing) =>
        val next = MatchDraft.Cancelled(
          id = e.id,
          createdByMemberId = e.createdByMemberId,
          heldEventId = e.heldEventId,
          matchNoInEvent = e.matchNoInEvent,
          gameTitleId = e.gameTitleId,
          layoutFamily = e.layoutFamily,
          seasonMasterId = e.seasonMasterId,
          ownerMemberId = e.ownerMemberId,
          mapMasterId = e.mapMasterId,
          playedAt = e.playedAt,
          totalAssetsImageId = e.totalAssetsImageId,
          revenueImageId = e.revenueImageId,
          incidentLogImageId = e.incidentLogImageId,
          totalAssetsDraftId = e.totalAssetsDraftId,
          revenueDraftId = e.revenueDraftId,
          incidentLogDraftId = e.incidentLogDraftId,
          sourceImagesRetainedUntil = e.sourceImagesRetainedUntil,
          sourceImagesDeletedAt = e.sourceImagesDeletedAt,
          createdAt = e.createdAt,
          updatedAt = updatedAt,
        )
        (current + (draftId -> next), true)
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
      case Some(e: MatchDraft.Editing) =>
        val withArtifacts = screenType match
          case ScreenType.TotalAssets => e
              .copy(totalAssetsImageId = Some(sourceImageId), totalAssetsDraftId = Some(ocrDraftId))
          case ScreenType.Revenue => e
              .copy(revenueImageId = Some(sourceImageId), revenueDraftId = Some(ocrDraftId))
          case ScreenType.IncidentLog => e
              .copy(incidentLogImageId = Some(sourceImageId), incidentLogDraftId = Some(ocrDraftId))
          case ScreenType.Auto => e
        val next = withArtifacts.copy(
          status = MatchDraftStatus.OcrRunning,
          updatedAt = updatedAt,
          sourceImagesDeletedAt = None,
        )
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
      case Some(e: MatchDraft.Editing) =>
        val next = e.copy(
          sourceImagesRetainedUntil = retainedUntil,
          sourceImagesDeletedAt = deletedAt,
          updatedAt = updatedAt,
        )
        (current + (draftId -> next), true)
      case Some(c: MatchDraft.Confirmed) =>
        val next = c.copy(
          sourceImagesRetainedUntil = retainedUntil,
          sourceImagesDeletedAt = deletedAt,
          updatedAt = updatedAt,
        )
        (current + (draftId -> next), true)
      case Some(c: MatchDraft.Cancelled) =>
        val next = c.copy(
          sourceImagesRetainedUntil = retainedUntil,
          sourceImagesDeletedAt = deletedAt,
          updatedAt = updatedAt,
        )
        (current + (draftId -> next), true)
  }

  private def withUpdatedAt(draft: MatchDraft, updatedAt: Instant): MatchDraft = draft match
    case e: MatchDraft.Editing => e.copy(updatedAt = updatedAt)
    case c: MatchDraft.Confirmed => c.copy(updatedAt = updatedAt)
    case c: MatchDraft.Cancelled => c.copy(updatedAt = updatedAt)

object InMemoryMatchDraftsRepository:
  def create[F[_]: Sync]: F[InMemoryMatchDraftsRepository[F]] = Ref
    .of[F, Map[MatchDraftId, MatchDraft]](Map.empty).map(new InMemoryMatchDraftsRepository(_))
