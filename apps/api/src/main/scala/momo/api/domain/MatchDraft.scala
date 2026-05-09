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
)

object MatchDraftCommon:
  def apply(
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
  ): MatchDraftCommon = MatchDraftCommon(
    id = id,
    createdByAccountId = AccountId(createdByMemberId.value),
    createdByMemberId = Some(createdByMemberId),
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

sealed trait MatchDraft derives CanEqual:
  def common: MatchDraftCommon
  def status: MatchDraftStatus
  def confirmedMatchId: Option[MatchId]

  def id: MatchDraftId = common.id
  def createdByAccountId: AccountId = common.createdByAccountId
  def createdByMemberId: Option[MemberId] = common.createdByMemberId
  def heldEventId: Option[HeldEventId] = common.heldEventId
  def matchNoInEvent: Option[Int] = common.matchNoInEvent
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
    case e: MatchDraft.Editing => e.copy(common = f(e.common))
    case c: MatchDraft.Confirmed => c.copy(common = f(c.common))
    case c: MatchDraft.Cancelled => c.copy(common = f(c.common))

object MatchDraft:
  def fromInputs(
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
  ): Either[MatchDraftError, MatchDraft] = fromInputs(
    id = id,
    createdByAccountId = AccountId(createdByMemberId.value),
    createdByMemberId = Some(createdByMemberId),
    status = status,
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
    confirmedMatchId = confirmedMatchId,
    createdAt = createdAt,
    updatedAt = updatedAt,
  )

  /**
   * Editing-state draft: any non-terminal status (OcrRunning, OcrFailed, DraftReady, NeedsReview).
   * Cannot carry a confirmedMatchId.
   */
  final case class Editing(common: MatchDraftCommon, status: MatchDraftStatus) extends MatchDraft:
    val confirmedMatchId: Option[MatchId] = None

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
      case (other, None) => Right(Editing(common, other))
      case (other, Some(_)) => Left(MatchDraftError.StatusForbidsConfirmedMatchId(other))
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
