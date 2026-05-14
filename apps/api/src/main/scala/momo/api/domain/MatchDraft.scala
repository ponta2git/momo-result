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

final case class MatchDraftOcrSlot(jobStatus: Option[OcrJobStatus], hasWarnings: Boolean)

object MatchDraftOcrStatus:
  def project(current: MatchDraftStatus, slots: List[MatchDraftOcrSlot]): MatchDraftStatus =
    if current != MatchDraftStatus.OcrRunning || slots.isEmpty then current
    else projectRunning(slots)

  def projectRunning(slots: List[MatchDraftOcrSlot]): MatchDraftStatus =
    if slots.exists(slot => slot.jobStatus.forall(isPending)) then MatchDraftStatus.OcrRunning
    else if slots.exists(slot => slot.jobStatus.exists(isFailed)) then MatchDraftStatus.OcrFailed
    else if slots.exists(_.hasWarnings) then MatchDraftStatus.NeedsReview
    else MatchDraftStatus.DraftReady

  private def isPending(status: OcrJobStatus): Boolean = status == OcrJobStatus.Queued ||
    status == OcrJobStatus.Running

  private def isFailed(status: OcrJobStatus): Boolean = status == OcrJobStatus.Failed ||
    status == OcrJobStatus.Cancelled

enum MatchListItemKind(val wire: String) derives CanEqual:
  case Match extends MatchListItemKind("match")
  case MatchDraft extends MatchListItemKind("match_draft")

object MatchListItemKind:
  def fromWire(value: String): Option[MatchListItemKind] = values.find(_.wire == value)

final case class MatchListRankEntry(memberId: MemberId, rank: Rank, playOrder: PlayOrder)

/** Inconsistencies surfaced by [[MatchDraft.fromInputs]] when status / confirmedMatchId disagree. */
enum MatchDraftError derives CanEqual:
  case ConfirmedRequiresMatchId
  case StatusForbidsConfirmedMatchId(status: MatchDraftStatus)

  def message: String = this match
    case ConfirmedRequiresMatchId =>
      "match draft with status=confirmed must carry a confirmedMatchId."
    case StatusForbidsConfirmedMatchId(s) =>
      s"match draft with status=${s.wire} must not carry a confirmedMatchId."

/**
 * Fields shared by every [[MatchDraft]] variant. Extracted into a single case class so each
 * variant declares only its variant-specific bits and so that bulk-copy operations across
 * lifecycle transitions (Editing → Confirmed / Cancelled) become a single field assignment.
 */
final case class MatchDraftCommon(
    id: MatchDraftId,
    createdByAccountId: AccountId,
    createdByMemberId: Option[MemberId],
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[MatchNoInEvent],
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
)

sealed trait MatchDraft derives CanEqual:
  def common: MatchDraftCommon
  def status: MatchDraftStatus
  def confirmedMatchId: Option[MatchId]

  def id: MatchDraftId = common.id
  def createdByAccountId: AccountId = common.createdByAccountId
  def createdByMemberId: Option[MemberId] = common.createdByMemberId
  def heldEventId: Option[HeldEventId] = common.heldEventId
  def matchNoInEvent: Option[MatchNoInEvent] = common.matchNoInEvent
  def gameTitleId: Option[GameTitleId] = common.gameTitleId
  def layoutFamily: Option[String] = common.layoutFamily
  def seasonMasterId: Option[SeasonMasterId] = common.seasonMasterId
  def ownerMemberId: Option[MemberId] = common.ownerMemberId
  def mapMasterId: Option[MapMasterId] = common.mapMasterId
  def playedAt: Option[Instant] = common.playedAt
  def totalAssetsImageId: Option[ImageId] = common.totalAssetsImageId
  def revenueImageId: Option[ImageId] = common.revenueImageId
  def incidentLogImageId: Option[ImageId] = common.incidentLogImageId
  def totalAssetsDraftId: Option[OcrDraftId] = common.totalAssetsDraftId
  def revenueDraftId: Option[OcrDraftId] = common.revenueDraftId
  def incidentLogDraftId: Option[OcrDraftId] = common.incidentLogDraftId
  def sourceImagesRetainedUntil: Option[Instant] = common.sourceImagesRetainedUntil
  def sourceImagesDeletedAt: Option[Instant] = common.sourceImagesDeletedAt
  def createdAt: Instant = common.createdAt
  def updatedAt: Instant = common.updatedAt

  /** Apply a transformation to the shared fields without changing the variant. */
  def withCommon(f: MatchDraftCommon => MatchDraftCommon): MatchDraft = this match
    case d: MatchDraft.OcrRunning => d.copy(common = f(d.common))
    case d: MatchDraft.OcrFailed => d.copy(common = f(d.common))
    case d: MatchDraft.DraftReady => d.copy(common = f(d.common))
    case d: MatchDraft.NeedsReview => d.copy(common = f(d.common))
    case c: MatchDraft.Confirmed => c.copy(common = f(c.common))
    case c: MatchDraft.Cancelled => c.copy(common = f(c.common))

object MatchDraft:
  sealed trait Editable extends MatchDraft:
    val confirmedMatchId: Option[MatchId] = None

  final case class OcrRunning(common: MatchDraftCommon) extends Editable:
    val status: MatchDraftStatus = MatchDraftStatus.OcrRunning

  final case class OcrFailed(common: MatchDraftCommon) extends Editable:
    val status: MatchDraftStatus = MatchDraftStatus.OcrFailed

  final case class DraftReady(common: MatchDraftCommon) extends Editable:
    val status: MatchDraftStatus = MatchDraftStatus.DraftReady

  final case class NeedsReview(common: MatchDraftCommon) extends Editable:
    val status: MatchDraftStatus = MatchDraftStatus.NeedsReview

  def editable(
      common: MatchDraftCommon,
      status: MatchDraftStatus,
  ): Either[MatchDraftError, Editable] = status match
    case MatchDraftStatus.OcrRunning => Right(OcrRunning(common))
    case MatchDraftStatus.OcrFailed => Right(OcrFailed(common))
    case MatchDraftStatus.DraftReady => Right(DraftReady(common))
    case MatchDraftStatus.NeedsReview => Right(NeedsReview(common))
    case other => Left(MatchDraftError.StatusForbidsConfirmedMatchId(other))

  /** Terminal confirmed draft: status fixed to Confirmed and confirmedMatchId required. */
  final case class Confirmed(common: MatchDraftCommon, confirmedMatchIdValue: MatchId)
      extends MatchDraft:
    val status: MatchDraftStatus = MatchDraftStatus.Confirmed
    override val confirmedMatchId: Option[MatchId] = Some(confirmedMatchIdValue)

  /** Terminal cancelled draft: status fixed to Cancelled, no confirmedMatchId. */
  final case class Cancelled(common: MatchDraftCommon) extends MatchDraft:
    val status: MatchDraftStatus = MatchDraftStatus.Cancelled
    val confirmedMatchId: Option[MatchId] = None

  /**
   * Smart factory used by call sites that work with the flat 22-arg shape (use cases, tests, repo
   * loaders). Produces the appropriate variant or surfaces a [[MatchDraftError]] when status and
   * `confirmedMatchId` disagree.
   */
  def fromInputs(
      id: MatchDraftId,
      createdByAccountId: AccountId,
      createdByMemberId: Option[MemberId],
      status: MatchDraftStatus,
      heldEventId: Option[HeldEventId],
      matchNoInEvent: Option[MatchNoInEvent],
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
  ): Either[MatchDraftError, MatchDraft] =
    val common = MatchDraftCommon(
      id = id,
      createdByAccountId = createdByAccountId,
      createdByMemberId = createdByMemberId,
      heldEventId = heldEventId,
      matchNoInEvent = matchNoInEvent,
      gameTitleId = gameTitleId,
      layoutFamily = layoutFamily,
      seasonMasterId = seasonMasterId,
      ownerMemberId = ownerMemberId,
      mapMasterId = mapMasterId,
      playedAt = playedAt,
      totalAssetsImageId = totalAssetsImageId,
      revenueImageId = revenueImageId,
      incidentLogImageId = incidentLogImageId,
      totalAssetsDraftId = totalAssetsDraftId,
      revenueDraftId = revenueDraftId,
      incidentLogDraftId = incidentLogDraftId,
      sourceImagesRetainedUntil = sourceImagesRetainedUntil,
      sourceImagesDeletedAt = sourceImagesDeletedAt,
      createdAt = createdAt,
      updatedAt = updatedAt,
    )
    (status, confirmedMatchId) match
      case (MatchDraftStatus.Confirmed, Some(matchId)) => Right(Confirmed(common, matchId))
      case (MatchDraftStatus.Confirmed, None) => Left(MatchDraftError.ConfirmedRequiresMatchId)
      case (MatchDraftStatus.Cancelled, None) => Right(Cancelled(common))
      case (MatchDraftStatus.Cancelled, Some(_)) =>
        Left(MatchDraftError.StatusForbidsConfirmedMatchId(MatchDraftStatus.Cancelled))
      case (other, None) => editable(common, other)
      case (other, Some(_)) => Left(MatchDraftError.StatusForbidsConfirmedMatchId(other))
end MatchDraft

final case class MatchListItem(
    kind: MatchListItemKind,
    id: String,
    matchId: Option[MatchId],
    matchDraftId: Option[MatchDraftId],
    status: String,
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[MatchNoInEvent],
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
    mapMasterId: Option[MapMasterId],
    ownerMemberId: Option[MemberId],
    playedAt: Option[Instant],
    createdAt: Instant,
    updatedAt: Instant,
    ranks: List[MatchListRankEntry],
)
