package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

enum MatchDraftStatus(val wire: String) derives CanEqual:
  case OcrRunning extends MatchDraftStatus("ocr_running")
  case OcrFailed extends MatchDraftStatus("ocr_failed")
  case DraftReady extends MatchDraftStatus("draft_ready")
  case NeedsReview extends MatchDraftStatus("needs_review")
  case Confirmed extends MatchDraftStatus("confirmed")
  case Cancelled extends MatchDraftStatus("cancelled")

object MatchDraftStatus:
  def fromWire(value: String): Option[MatchDraftStatus] = values.find(_.wire == value)

enum MatchListItemKind(val wire: String) derives CanEqual:
  case Match extends MatchListItemKind("match")
  case MatchDraft extends MatchListItemKind("match_draft")

object MatchListItemKind:
  def fromWire(value: String): Option[MatchListItemKind] = values.find(_.wire == value)

final case class MatchListRankEntry(memberId: MemberId, rank: Int, playOrder: Int)

final case class MatchDraft(
    id: MatchDraftId,
    createdByMemberId: MemberId,
    status: MatchDraftStatus,
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[GameTitleId],
    layoutFamily: Option[String],
    seasonMasterId: Option[SeasonMasterId],
    ownerMemberId: Option[MemberId],
    mapMasterId: Option[MapMasterId],
    playedAt: Option[Instant],
    totalAssetsImageId: Option[ImageId],
    revenueImageId: Option[ImageId],
    incidentLogImageId: Option[ImageId],
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
    sourceImagesRetainedUntil: Option[Instant],
    sourceImagesDeletedAt: Option[Instant],
    confirmedMatchId: Option[MatchId],
    createdAt: Instant,
    updatedAt: Instant,
)

final case class MatchListItem(
    kind: MatchListItemKind,
    id: String,
    matchId: Option[MatchId],
    matchDraftId: Option[MatchDraftId],
    status: String,
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
    mapMasterId: Option[MapMasterId],
    ownerMemberId: Option[MemberId],
    playedAt: Option[Instant],
    createdAt: Instant,
    updatedAt: Instant,
    ranks: List[MatchListRankEntry],
)
