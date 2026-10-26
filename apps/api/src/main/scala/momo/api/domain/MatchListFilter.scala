package momo.api.domain

import java.time.{Instant, LocalDate, ZoneId}

import momo.api.domain.ids.{MapMasterId, MemberId}

enum MatchListStatusFilter(val wire: String) derives CanEqual:
  case All extends MatchListStatusFilter("all")
  case Incomplete extends MatchListStatusFilter("incomplete")
  case OcrRunning extends MatchListStatusFilter("ocr_running")
  case PreConfirm extends MatchListStatusFilter("pre_confirm")
  case NeedsReview extends MatchListStatusFilter("needs_review")
  case Confirmed extends MatchListStatusFilter("confirmed")

object MatchListStatusFilter:
  def fromWire(value: String): Option[MatchListStatusFilter] = values.find(_.wire == value)

  val incompleteStatuses: Set[MatchDraftStatus] = Set(
    MatchDraftStatus.OcrRunning,
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )

enum MatchListKindFilter(val wire: String) derives CanEqual:
  case All extends MatchListKindFilter("all")
  case Match extends MatchListKindFilter("match")
  case MatchDraft extends MatchListKindFilter("match_draft")

object MatchListKindFilter:
  def fromWire(value: String): Option[MatchListKindFilter] = values.find(_.wire == value)

enum MatchListSort(val wire: String) derives CanEqual:
  case StatusPriority extends MatchListSort("status_priority")
  case UpdatedDesc extends MatchListSort("updated_desc")
  case HeldDesc extends MatchListSort("held_desc")
  case HeldAsc extends MatchListSort("held_asc")
  case MatchNoAsc extends MatchListSort("match_no_asc")

object MatchListSort:
  def fromWire(value: String): Option[MatchListSort] = values.find(_.wire == value)

final case class MatchListSummary(
    incompleteCount: Int,
    ocrRunningCount: Int,
    preConfirmCount: Int,
    needsReviewCount: Int,
)

/** Player result columns that a confirmed-match search can compare against a value. */
enum MatchListRecordField(val wire: String, val incidentKind: Option[IncidentKind])
    derives CanEqual:
  case Destination extends MatchListRecordField("destination", Some(IncidentKind.Destination))
  case PlusStation extends MatchListRecordField("plus_station", Some(IncidentKind.PlusStation))
  case MinusStation extends MatchListRecordField("minus_station", Some(IncidentKind.MinusStation))
  case CardStation extends MatchListRecordField("card_station", Some(IncidentKind.CardStation))
  case CardShop extends MatchListRecordField("card_shop", Some(IncidentKind.CardShop))
  case SuriNoGinji extends MatchListRecordField("suri_no_ginji", Some(IncidentKind.SuriNoGinji))
  case TotalAssets extends MatchListRecordField("total_assets", None)
  case Revenue extends MatchListRecordField("revenue", None)

object MatchListRecordField:
  def fromWire(value: String): Option[MatchListRecordField] = values.find(_.wire == value)

enum MatchListRecordRange(val wire: String) derives CanEqual:
  case Gte extends MatchListRecordRange("gte")
  case Lte extends MatchListRecordRange("lte")

object MatchListRecordRange:
  def fromWire(value: String): Option[MatchListRecordRange] = values.find(_.wire == value)

/**
 * `memberId = None` matches when any of the four players satisfies the comparison. An incident
 * without a stored count row compares as 0.
 */
final case class MatchListRecordCriterion(
    field: MatchListRecordField,
    value: Int,
    range: MatchListRecordRange,
    memberId: Option[MemberId],
) derives CanEqual

/**
 * Criteria that only apply to confirmed matches. Dates are inclusive calendar days in Asia/Tokyo
 * and compare against the same held-at value used by the held-at sorts.
 */
final case class MatchListSearchCriteria(
    mapMasterId: Option[MapMasterId] = None,
    from: Option[LocalDate] = None,
    to: Option[LocalDate] = None,
    noteQuery: Option[String] = None,
    record: Option[MatchListRecordCriterion] = None,
) derives CanEqual:
  def isEmpty: Boolean = this == MatchListSearchCriteria.empty
  def heldFromInclusive: Option[Instant] = from
    .map(_.atStartOfDay(MatchListSearchCriteria.Zone).toInstant)
  def heldToExclusive: Option[Instant] = to
    .map(_.plusDays(1).atStartOfDay(MatchListSearchCriteria.Zone).toInstant)

object MatchListSearchCriteria:
  val empty: MatchListSearchCriteria = MatchListSearchCriteria()
  val NoteQueryMaxCodePoints = 50
  private val Zone: ZoneId = ZoneId.of("Asia/Tokyo")
