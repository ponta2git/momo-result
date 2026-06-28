package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.json.circe.*

import momo.api.endpoints.ProblemDetails.ProblemResponse

object SeriesComparisonEndpoints:
  private type SecuredRead[I, O] = Endpoint[Option[String], I, ProblemResponse, O, Any]

  val options: SecuredRead[Unit, SeriesComparisonOptionsResponse] =
    endpoint
      .securityIn(CommonEndpoint.accountHeader)
      .get
      .in("api" / "analytics" / "series-comparison" / "options")
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonOptionsResponse])
      .tag("analytics")

  type AggregateInput =
    (String, Option[String], Option[String], Option[String], Option[String])

  val aggregate: SecuredRead[AggregateInput, SeriesComparisonResponse] =
    endpoint
      .securityIn(CommonEndpoint.accountHeader)
      .get
      .in("api" / "analytics" / "series-comparison")
      .in(query[String]("gameTitleId"))
      .in(query[Option[String]]("scopeKind"))
      .in(query[Option[String]]("scopeId"))
      .in(query[Option[String]]("seasonMasterId"))
      .in(query[Option[String]]("mapMasterId"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonResponse])
      .tag("analytics")

  type ReviewInput = (String, Option[String], Option[String])

  val review: SecuredRead[ReviewInput, SeriesComparisonReviewResponse] =
    endpoint
      .securityIn(CommonEndpoint.accountHeader)
      .get
      .in("api" / "analytics" / "series-comparison" / "review")
      .in(query[String]("gameTitleId"))
      .in(query[Option[String]]("seasonMasterId"))
      .in(query[Option[String]]("mapMasterId"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonReviewResponse])
      .tag("analytics")

  type DrilldownInput = (String, String, String, Option[String], Option[String])

  val drilldown: SecuredRead[DrilldownInput, SeriesComparisonDrilldownResponse] =
    endpoint
      .securityIn(CommonEndpoint.accountHeader)
      .get
      .in("api" / "analytics" / "series-comparison" / "drilldown")
      .in(query[String]("gameTitleId"))
      .in(query[String]("metricId"))
      .in(query[String]("memberId"))
      .in(query[Option[String]]("seasonMasterId"))
      .in(query[Option[String]]("mapMasterId"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeriesComparisonDrilldownResponse])
      .tag("analytics")
