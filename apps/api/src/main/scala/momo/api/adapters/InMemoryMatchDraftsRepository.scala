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
        val next = draft.withCommon(_.copy(updatedAt = updatedAt))
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
          common = e.common.copy(updatedAt = updatedAt),
          confirmedMatchIdValue = confirmedMatchId,
        )
        (current + (draftId -> next), true)
      case _ => (current, false)
  }

  override def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = ref
    .modify { current =>
      current.get(draftId) match
        case Some(e: MatchDraft.Editing) =>
          val next = e.copy(
            common = e.common.copy(updatedAt = updatedAt),
            status = MatchDraftStatus.OcrFailed,
          )
          (current + (draftId -> next), true)
        case _ => (current, false)
    }

  override def cancel(draftId: MatchDraftId, updatedAt: Instant): F[Boolean] = ref.modify { current =>
    current.get(draftId) match
      case Some(e: MatchDraft.Editing) =>
        val next = MatchDraft.Cancelled(common = e.common.copy(updatedAt = updatedAt))
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
          case ScreenType.TotalAssets => e.common
              .copy(totalAssetsImageId = Some(sourceImageId), totalAssetsDraftId = Some(ocrDraftId))
          case ScreenType.Revenue => e.common
              .copy(revenueImageId = Some(sourceImageId), revenueDraftId = Some(ocrDraftId))
          case ScreenType.IncidentLog => e.common
              .copy(incidentLogImageId = Some(sourceImageId), incidentLogDraftId = Some(ocrDraftId))
          case ScreenType.Auto => e.common
        val next = e.copy(
          common = withArtifacts.copy(updatedAt = updatedAt, sourceImagesDeletedAt = None),
          status = MatchDraftStatus.OcrRunning,
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
      case Some(draft) =>
        val next = draft.withCommon(_.copy(
          sourceImagesRetainedUntil = retainedUntil,
          sourceImagesDeletedAt = deletedAt,
          updatedAt = updatedAt,
        ))
        (current + (draftId -> next), true)
  }

object InMemoryMatchDraftsRepository:
  def create[F[_]: Sync]: F[InMemoryMatchDraftsRepository[F]] = Ref
    .of[F, Map[MatchDraftId, MatchDraft]](Map.empty).map(new InMemoryMatchDraftsRepository(_))
