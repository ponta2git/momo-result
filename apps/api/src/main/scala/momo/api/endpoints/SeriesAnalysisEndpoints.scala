package momo.api.endpoints

import io.circe.Json
import sttp.model.StatusCode
import sttp.tapir.*
import sttp.tapir.json.circe.*

import momo.api.endpoints.ProblemDetails.ProblemResponse
import momo.api.endpoints.SeriesAnalysisApiSchemas.given

object SeriesAnalysisEndpoints:
  private type SecuredRead[I, O] = Endpoint[Option[String], I, ProblemResponse, O, Any]
  private type SecuredMutation[I, O] =
    Endpoint[(Option[String], Option[String]), I, ProblemResponse, O, Any]

  private val noStore = header("Cache-Control", "private, no-store")
  private given Schema[Json] = Schema.anyObject[Json]

  val options: SecuredRead[Unit, SeriesAnalysisOptionsResponse] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / "options")
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeriesAnalysisOptionsResponse])
    .out(noStore)
    .tag("analytics")

  val status: SecuredRead[String, SeriesAnalysisStatusResponse] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / "status")
    .in(query[String]("gameTitleId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeriesAnalysisStatusResponse])
    .out(noStore)
    .tag("analytics")

  type ScopedArtifactInput = (String, String, Option[String], Option[String])
  type DrilldownInput = (String, String, String, String, Option[String], Option[String])
  type MatchContextInput = (String, String, String, Option[String], Option[String])

  val aggregate: SecuredRead[ScopedArtifactInput, Json] = artifactEndpoint("aggregate")
  val review: SecuredRead[ScopedArtifactInput, Json] = artifactEndpoint("review")

  val drilldown: SecuredRead[DrilldownInput, Json] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / "drilldown")
    .in(query[String]("gameTitleId"))
    .in(query[String]("artifactId"))
    .in(query[String]("memberId"))
    .in(query[String]("metricId"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("mapMasterId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[Json])
    .out(noStore)
    .tag("analytics")

  val matchContext: SecuredRead[MatchContextInput, Json] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / "match-context")
    .in(query[String]("gameTitleId"))
    .in(query[String]("artifactId"))
    .in(query[String]("matchId"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("mapMasterId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[Json])
    .out(noStore)
    .tag("analytics")

  val adminOverview: SecuredRead[Option[String], SeriesAnalysisAdminOverviewResponse] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "admin" / "series-analysis" / "overview")
    .in(query[Option[String]]("gameTitleId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeriesAnalysisAdminOverviewResponse])
    .out(noStore)
    .tag("admin-analysis")

  type TitleRecalculationInput = (Option[String], SeriesAnalysisRecalculationRequest)
  type AllRecalculationInput = (Option[String], SeriesAnalysisAllRecalculationRequest)

  val recalculateTitle
      : SecuredMutation[TitleRecalculationInput, SeriesAnalysisRecalculationAcceptedResponse] =
    endpoint
      .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
      .post
      .in("api" / "admin" / "series-analysis" / "recalculations")
      .in(header[Option[String]]("Idempotency-Key"))
      .in(jsonBody[SeriesAnalysisRecalculationRequest])
      .errorOut(CommonEndpoint.errorOut)
      .out(statusCode(StatusCode.Accepted))
      .out(jsonBody[SeriesAnalysisRecalculationAcceptedResponse])
      .out(noStore)
      .tag("admin-analysis")

  val recalculateAll
      : SecuredMutation[AllRecalculationInput, SeriesAnalysisRecalculationAcceptedResponse] =
    endpoint
      .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
      .post
      .in("api" / "admin" / "series-analysis" / "recalculations" / "all")
      .in(header[Option[String]]("Idempotency-Key"))
      .in(jsonBody[SeriesAnalysisAllRecalculationRequest])
      .errorOut(CommonEndpoint.errorOut)
      .out(statusCode(StatusCode.Accepted))
      .out(jsonBody[SeriesAnalysisRecalculationAcceptedResponse])
      .out(noStore)
      .tag("admin-analysis")

  private def artifactEndpoint(path: String): SecuredRead[ScopedArtifactInput, Json] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / path)
    .in(query[String]("gameTitleId"))
    .in(query[String]("artifactId"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("mapMasterId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[Json])
    .out(noStore)
    .tag("analytics")
