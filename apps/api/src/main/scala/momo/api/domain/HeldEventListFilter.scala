package momo.api.domain

import java.time.{Instant, LocalDate}

import momo.api.domain.ids.{GameTitleId, MapMasterId, MemberId, SeasonMasterId}

enum HeldEventListSort(val wire: String) derives CanEqual:
  case HeldDesc extends HeldEventListSort("held_desc")
  case HeldAsc extends HeldEventListSort("held_asc")

object HeldEventListSort:
  def fromWire(value: String): Option[HeldEventListSort] = values.find(_.wire == value)

/** A player's result over one held event's confirmed matches. */
enum HeldEventListMetric(val wire: String, val countedRank: Option[Int]) derives CanEqual:
  case AverageRank extends HeldEventListMetric("average_rank", None)
  case Rank1Count extends HeldEventListMetric("rank1_count", Some(1))
  case Rank2Count extends HeldEventListMetric("rank2_count", Some(2))
  case Rank3Count extends HeldEventListMetric("rank3_count", Some(3))
  case Rank4Count extends HeldEventListMetric("rank4_count", Some(4))

object HeldEventListMetric:
  def fromWire(value: String): Option[HeldEventListMetric] = values.find(_.wire == value)

  val AverageRankMinimum: BigDecimal = BigDecimal(1)
  val AverageRankMaximum: BigDecimal = BigDecimal(4)
  /** Averages compare after rounding to this scale, matching the displayed value. */
  val AverageRankScale = 2

/**
 * `memberId = None` matches when any player of the event satisfies the comparison. Only members
 * who played a confirmed match of the event have a result, so an event without one never matches.
 */
final case class HeldEventListMetricCriterion(
    metric: HeldEventListMetric,
    value: BigDecimal,
    range: MatchListRecordRange,
    memberId: Option[MemberId],
) derives CanEqual

/**
 * Held-event search over confirmed matches. Title, season and map must hold for one confirmed
 * match; dates are inclusive Asia/Tokyo calendar days on the held-event start time.
 */
final case class HeldEventListSearchCriteria(
    gameTitleId: Option[GameTitleId] = None,
    seasonMasterId: Option[SeasonMasterId] = None,
    mapMasterId: Option[MapMasterId] = None,
    from: Option[LocalDate] = None,
    to: Option[LocalDate] = None,
    minMatchCount: Option[Int] = None,
    noteQuery: Option[String] = None,
    metric: Option[HeldEventListMetricCriterion] = None,
) derives CanEqual:
  def isEmpty: Boolean = this == HeldEventListSearchCriteria.empty
  def heldFromInclusive: Option[Instant] = from.map(MatchListSearchCriteria.dayStart)
  def heldToExclusive: Option[Instant] = to
    .map(day => MatchListSearchCriteria.dayStart(day.plusDays(1)))

object HeldEventListSearchCriteria:
  val empty: HeldEventListSearchCriteria = HeldEventListSearchCriteria()
