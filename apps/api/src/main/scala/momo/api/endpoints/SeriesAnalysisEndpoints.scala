package momo.api.endpoints

import sttp.model.StatusCode
import sttp.tapir.*
import sttp.tapir.json.circe.*

import momo.api.endpoints.CommonEndpoint.{SecuredMutation, SecuredRead}
import momo.api.endpoints.SeriesAnalysisApiSchemas.given

object SeriesAnalysisEndpoints:
  private val noStore = header("Cache-Control", "private, no-store")
  private val rawJsonBody: EndpointIO.Body[Array[Byte], Array[Byte]] = EndpointIO.Body(
    RawBodyType.ByteArrayBody,
    Codec.id(CodecFormat.Json(), Schema.anyObject[Array[Byte]]),
    EndpointIO.Info.empty,
  )

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

  final case class ScopedArtifactInput(
      gameTitleId: String,
      artifactId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  )

  final case class DrilldownInput(
      gameTitleId: String,
      artifactId: String,
      memberId: String,
      metricId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  )

  final case class MatchContextInput(
      gameTitleId: String,
      artifactId: String,
      matchId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  )

  private val scopedArtifactInput: EndpointInput[ScopedArtifactInput] = query[String]("gameTitleId")
    .and(query[String]("artifactId"))
    .and(query[Option[String]]("seasonMasterId"))
    .and(query[Option[String]]("mapMasterId"))
    .mapTo[ScopedArtifactInput]

  private val drilldownInput: EndpointInput[DrilldownInput] = query[String]("gameTitleId")
    .and(query[String]("artifactId"))
    .and(query[String]("memberId"))
    .and(query[String]("metricId"))
    .and(query[Option[String]]("seasonMasterId"))
    .and(query[Option[String]]("mapMasterId"))
    .mapTo[DrilldownInput]

  private val matchContextInput: EndpointInput[MatchContextInput] = query[String]("gameTitleId")
    .and(query[String]("artifactId"))
    .and(query[String]("matchId"))
    .and(query[Option[String]]("seasonMasterId"))
    .and(query[Option[String]]("mapMasterId"))
    .mapTo[MatchContextInput]

  val aggregate: SecuredRead[ScopedArtifactInput, Array[Byte]] = artifactEndpoint("aggregate")
  val review: SecuredRead[ScopedArtifactInput, Array[Byte]] = artifactEndpoint("review")

  val drilldown: SecuredRead[DrilldownInput, Array[Byte]] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / "drilldown")
    .in(drilldownInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(rawJsonBody)
    .out(noStore)
    .tag("analytics")

  val matchContext: SecuredRead[MatchContextInput, Array[Byte]] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / "match-context")
    .in(matchContextInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(rawJsonBody)
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
      .in(CommonEndpoint.idempotencyKeyHeader)
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
      .in(CommonEndpoint.idempotencyKeyHeader)
      .in(jsonBody[SeriesAnalysisAllRecalculationRequest])
      .errorOut(CommonEndpoint.errorOut)
      .out(statusCode(StatusCode.Accepted))
      .out(jsonBody[SeriesAnalysisRecalculationAcceptedResponse])
      .out(noStore)
      .tag("admin-analysis")

  private def artifactEndpoint(
      path: String
  ): SecuredRead[ScopedArtifactInput, Array[Byte]] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "analytics" / "series-comparison" / "v2" / path)
    .in(scopedArtifactInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(rawJsonBody)
    .out(noStore)
    .tag("analytics")
