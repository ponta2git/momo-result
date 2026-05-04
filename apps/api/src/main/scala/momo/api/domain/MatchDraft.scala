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

sealed trait MatchDraft derives CanEqual:
  def id: MatchDraftId
  def createdByMemberId: MemberId
  def status: MatchDraftStatus
  def heldEventId: Option[HeldEventId]
  def matchNoInEvent: Option[Int]
  def gameTitleId: Option[GameTitleId]
  def layoutFamily: Option[String]
  def seasonMasterId: Option[SeasonMasterId]
  def ownerMemberId: Option[MemberId]
  def mapMasterId: Option[MapMasterId]
  def playedAt: Option[Instant]
  def totalAssetsImageId: Option[ImageId]
  def revenueImageId: Option[ImageId]
  def incidentLogImageId: Option[ImageId]
  def totalAssetsDraftId: Option[OcrDraftId]
  def revenueDraftId: Option[OcrDraftId]
  def incidentLogDraftId: Option[OcrDraftId]
  def sourceImagesRetainedUntil: Option[Instant]
  def sourceImagesDeletedAt: Option[Instant]
  def confirmedMatchId: Option[MatchId]
  def createdAt: Instant
  def updatedAt: Instant

object MatchDraft:
  /**
   * Editing-state draft: any non-terminal status (OcrRunning, OcrFailed, DraftReady, NeedsReview).
   * Cannot carry a confirmedMatchId.
   */
  final case class Editing(
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
      createdAt: Instant,
      updatedAt: Instant,
  ) extends MatchDraft:
    val confirmedMatchId: Option[MatchId] = None

  /** Terminal confirmed draft: status fixed to Confirmed and confirmedMatchId required. */
  final case class Confirmed(
      id: MatchDraftId,
      createdByMemberId: MemberId,
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
      confirmedMatchIdValue: MatchId,
      createdAt: Instant,
      updatedAt: Instant,
  ) extends MatchDraft:
    val status: MatchDraftStatus = MatchDraftStatus.Confirmed
    override val confirmedMatchId: Option[MatchId] = Some(confirmedMatchIdValue)

  /** Terminal cancelled draft: status fixed to Cancelled, no confirmedMatchId. */
  final case class Cancelled(
      id: MatchDraftId,
      createdByMemberId: MemberId,
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
      createdAt: Instant,
      updatedAt: Instant,
  ) extends MatchDraft:
    val status: MatchDraftStatus = MatchDraftStatus.Cancelled
    val confirmedMatchId: Option[MatchId] = None

  /**
   * Flat factory used by call sites that already had the 22-arg shape (use cases, tests, repo
   * loaders). Dispatches to the correct case based on `status`/`confirmedMatchId`. Inconsistent
   * combinations fall back to Editing — repo loaders are expected to enforce consistency before
   * calling this factory.
   */
  def apply(
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
  ): MatchDraft = status match
    case MatchDraftStatus.Confirmed => confirmedMatchId match
        case Some(matchId) => Confirmed(
            id,
            createdByMemberId,
            heldEventId,
            matchNoInEvent,
            gameTitleId,
            layoutFamily,
            seasonMasterId,
            ownerMemberId,
            mapMasterId,
            playedAt,
            totalAssetsImageId,
            revenueImageId,
            incidentLogImageId,
            totalAssetsDraftId,
            revenueDraftId,
            incidentLogDraftId,
            sourceImagesRetainedUntil,
            sourceImagesDeletedAt,
            matchId,
            createdAt,
            updatedAt,
          )
        case None => Editing(
            id,
            createdByMemberId,
            status,
            heldEventId,
            matchNoInEvent,
            gameTitleId,
            layoutFamily,
            seasonMasterId,
            ownerMemberId,
            mapMasterId,
            playedAt,
            totalAssetsImageId,
            revenueImageId,
            incidentLogImageId,
            totalAssetsDraftId,
            revenueDraftId,
            incidentLogDraftId,
            sourceImagesRetainedUntil,
            sourceImagesDeletedAt,
            createdAt,
            updatedAt,
          )
    case MatchDraftStatus.Cancelled => Cancelled(
        id,
        createdByMemberId,
        heldEventId,
        matchNoInEvent,
        gameTitleId,
        layoutFamily,
        seasonMasterId,
        ownerMemberId,
        mapMasterId,
        playedAt,
        totalAssetsImageId,
        revenueImageId,
        incidentLogImageId,
        totalAssetsDraftId,
        revenueDraftId,
        incidentLogDraftId,
        sourceImagesRetainedUntil,
        sourceImagesDeletedAt,
        createdAt,
        updatedAt,
      )
    case other => Editing(
        id,
        createdByMemberId,
        other,
        heldEventId,
        matchNoInEvent,
        gameTitleId,
        layoutFamily,
        seasonMasterId,
        ownerMemberId,
        mapMasterId,
        playedAt,
        totalAssetsImageId,
        revenueImageId,
        incidentLogImageId,
        totalAssetsDraftId,
        revenueDraftId,
        incidentLogDraftId,
        sourceImagesRetainedUntil,
        sourceImagesDeletedAt,
        createdAt,
        updatedAt,
      )
end MatchDraft

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
