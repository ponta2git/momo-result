package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.{MatchDraftId, OcrDraftId}
import momo.api.domain.{MatchDraft, MatchRecord}

final case class MatchDraftConfirmation(
    draftId: MatchDraftId,
    updatedAt: Instant,
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
)

object MatchDraftConfirmation:
  def from(draft: MatchDraft): MatchDraftConfirmation = MatchDraftConfirmation(
    draftId = draft.id,
    updatedAt = draft.updatedAt,
    totalAssetsDraftId = draft.totalAssetsDraftId,
    revenueDraftId = draft.revenueDraftId,
    incidentLogDraftId = draft.incidentLogDraftId,
  )

enum MatchConfirmationResult derives CanEqual:
  case Confirmed
  case DraftSnapshotMismatch

trait MatchConfirmationRepository[F[_]]:
  def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[MatchConfirmationResult]
