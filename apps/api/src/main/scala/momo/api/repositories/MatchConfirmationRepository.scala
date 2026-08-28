package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.{MatchDraftId, OcrDraftId}
import momo.api.domain.{MatchDraft, MatchRecord}
import momo.api.errors.AppError

final case class MatchDraftConfirmation(
    draftId: MatchDraftId,
    updatedAt: Instant,
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
) derives CanEqual

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

/** Atomic confirmation port. Business rejections are values; unexpected failures remain in F. */
trait MatchConfirmationRepository[F[_]]:
  def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[Either[AppError, MatchConfirmationResult]]
