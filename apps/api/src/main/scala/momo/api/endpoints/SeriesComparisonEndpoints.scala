package momo.api.endpoints

import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object SeriesComparisonEndpoints:
  val options
      : PublicEndpoint[Option[String], ProblemResponse, SeriesComparisonOptionsResponse, Any] =
    endpoint
      .get
      .in("api" / "analytics" / "series-comparison" / "options")
      .in(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonOptionsResponse])
      .tag("analytics")

  type AggregateInput =
    (String, Option[String], Option[String], Option[String], Option[String], Option[String])

  val aggregate: PublicEndpoint[AggregateInput, ProblemResponse, SeriesComparisonResponse, Any] =
    endpoint
      .get
      .in("api" / "analytics" / "series-comparison")
      .in(query[String]("gameTitleId"))
      .in(query[Option[String]]("scopeKind"))
      .in(query[Option[String]]("scopeId"))
      .in(query[Option[String]]("seasonMasterId"))
      .in(query[Option[String]]("mapMasterId"))
      .in(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonResponse])
      .tag("analytics")

  type ReviewInput = (String, Option[String], Option[String], Option[String])

  val review: PublicEndpoint[ReviewInput, ProblemResponse, SeriesComparisonReviewResponse, Any] =
    endpoint
      .get
      .in("api" / "analytics" / "series-comparison" / "review")
      .in(query[String]("gameTitleId"))
      .in(query[Option[String]]("seasonMasterId"))
      .in(query[Option[String]]("mapMasterId"))
      .in(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonReviewResponse])
      .tag("analytics")

  type DrilldownInput = (String, String, String, Option[String], Option[String], Option[String])

  val drilldown
      : PublicEndpoint[DrilldownInput, ProblemResponse, SeriesComparisonDrilldownResponse, Any] =
    endpoint
      .get
      .in("api" / "analytics" / "series-comparison" / "drilldown")
      .in(query[String]("gameTitleId"))
      .in(query[String]("metricId"))
      .in(query[String]("memberId"))
      .in(query[Option[String]]("seasonMasterId"))
      .in(query[Option[String]]("mapMasterId"))
      .in(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonDrilldownResponse])
      .tag("analytics")
