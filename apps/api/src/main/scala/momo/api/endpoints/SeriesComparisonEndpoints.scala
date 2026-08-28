package momo.api.endpoints

import sttp.tapir.*

import momo.api.endpoints.CommonEndpoint.SecuredRead

/** Fixed compatibility tombstones for clients that still call the removed synchronous API. */
object SeriesComparisonEndpoints:
  private type TombstoneEndpoint = SecuredRead[Unit, Unit]

  val options: TombstoneEndpoint = tombstone("options")
  val aggregate: TombstoneEndpoint = tombstone()
  val review: TombstoneEndpoint = tombstone("review")
  val drilldown: TombstoneEndpoint = tombstone("drilldown")

  private def tombstone(suffix: String*): TombstoneEndpoint =
    val base = endpoint
      .securityIn(CommonEndpoint.accountHeader)
      .get
      .in("api" / "analytics" / "series-comparison")
    val path = suffix.foldLeft(base)((current, segment) => current.in(segment))
    path.errorOut(CommonEndpoint.errorOut).tag("analytics-legacy")
