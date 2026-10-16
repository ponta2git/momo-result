package momo.api.domain

import cats.data.NonEmptyList

import momo.api.domain.ids.OcrDraftId

/** Confirmation is distinct from editing or cancelling a draft. */
object MatchDraftConfirmability:
  val statuses: NonEmptyList[MatchDraftStatus] = NonEmptyList.of(
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
    MatchDraftStatus.OcrFailed,
  )

  enum Rejection derives CanEqual:
    case Status(status: MatchDraftStatus)
    case TotalAssetsReference, RevenueReference, IncidentLogReference

  def allows(status: MatchDraftStatus): Boolean = statuses.toList.contains(status)

  def validate(
      draft: MatchDraft,
      totalAssets: Option[OcrDraftId],
      revenue: Option[OcrDraftId],
      incidentLog: Option[OcrDraftId],
  ): Either[Rejection, Unit] =
    if !allows(draft.status) then Left(Rejection.Status(draft.status))
    else if draft.totalAssetsDraftId != totalAssets then
      Left(Rejection.TotalAssetsReference)
    else if draft.revenueDraftId != revenue then
      Left(Rejection.RevenueReference)
    else if draft.incidentLogDraftId != incidentLog then
      Left(Rejection.IncidentLogReference)
    else Right(())
