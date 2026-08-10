package momo.api.endpoints

import sttp.tapir.*

import momo.api.endpoints.ProblemDetails.ProblemResponse

/** Fixed compatibility tombstones for clients that still call the removed synchronous API. */
object SeriesComparisonEndpoints:
  private type SecuredRead = Endpoint[Option[String], Unit, ProblemResponse, Unit, Any]

  val options: SecuredRead = tombstone("options")
  val aggregate: SecuredRead = tombstone()
  val review: SecuredRead = tombstone("review")
  val drilldown: SecuredRead = tombstone("drilldown")

  private def tombstone(suffix: String*): SecuredRead =
    val base = endpoint
      .securityIn(CommonEndpoint.accountHeader)
      .get
      .in("api" / "analytics" / "series-comparison")
    val path = suffix.foldLeft(base)((current, segment) => current.in(segment))
    path.errorOut(CommonEndpoint.errorOut).tag("analytics-legacy")
