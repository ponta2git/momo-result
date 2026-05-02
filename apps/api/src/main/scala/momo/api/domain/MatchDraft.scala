package momo.api.domain

import java.time.Instant

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

final case class MatchListRankEntry(memberId: String, rank: Int, playOrder: Int)

final case class MatchDraft(
    id: String,
    createdByMemberId: String,
    status: MatchDraftStatus,
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    layoutFamily: Option[String],
    seasonMasterId: Option[String],
    ownerMemberId: Option[String],
    mapMasterId: Option[String],
    playedAt: Option[Instant],
    totalAssetsImageId: Option[String],
    revenueImageId: Option[String],
    incidentLogImageId: Option[String],
    totalAssetsDraftId: Option[String],
    revenueDraftId: Option[String],
    incidentLogDraftId: Option[String],
    sourceImagesRetainedUntil: Option[Instant],
    sourceImagesDeletedAt: Option[Instant],
    confirmedMatchId: Option[String],
    createdAt: Instant,
    updatedAt: Instant,
)

final case class MatchListItem(
    kind: MatchListItemKind,
    id: String,
    matchId: Option[String],
    matchDraftId: Option[String],
    status: String,
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    seasonMasterId: Option[String],
    mapMasterId: Option[String],
    ownerMemberId: Option[String],
    playedAt: Option[Instant],
    createdAt: Instant,
    updatedAt: Instant,
    ranks: List[MatchListRankEntry],
)
