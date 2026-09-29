package momo.api.endpoints

import sttp.model.StatusCode
import sttp.tapir.*
import sttp.tapir.json.circe.*

import momo.api.endpoints.CommonEndpoint.{SecuredMutation, SecuredRead}
import momo.api.endpoints.SeriesPlayerRadarApiSchemas.given

object SeriesPlayerRadarEndpoints:
  private val noStore = header("Cache-Control", "private, no-store")

  private def savedDocument(componentName: String): EndpointIO.Body[Array[Byte], Array[Byte]] =
    EndpointIO.Body(
      RawBodyType.ByteArrayBody,
      Codec.id(CodecFormat.Json(), Schema.anyObject[Array[Byte]].name(Schema.SName(componentName))),
      EndpointIO.Info.empty,
    )

  val state: SecuredRead[String, Array[Byte]] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "admin" / "series-analysis" / "radar")
    .in(query[String]("gameTitleId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(savedDocument("SeriesPlayerRadarStateResponse"))
    .out(noStore)
    .tag("admin-analysis")

  final case class PreviewInput(
      gameTitleId: String,
      previewId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  )

  val preview: SecuredRead[PreviewInput, Array[Byte]] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "admin" / "series-analysis" / "radar" / "preview")
    .in(query[String]("gameTitleId")
      .and(query[String]("previewId"))
      .and(query[Option[String]]("seasonMasterId"))
      .and(query[Option[String]]("mapMasterId"))
      .mapTo[PreviewInput])
    .errorOut(CommonEndpoint.errorOut)
    .out(savedDocument("SeriesPlayerRadarPreviewResponse"))
    .out(noStore)
    .tag("admin-analysis")

  final case class OperationInput(gameTitleId: String, operationId: String)

  val operation: SecuredRead[OperationInput, SeriesPlayerRadarOperationResponse] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .get
    .in("api" / "admin" / "series-analysis" / "radar" / "operation")
    .in(query[String]("gameTitleId").and(query[String]("operationId")).mapTo[OperationInput])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeriesPlayerRadarOperationResponse])
    .out(noStore)
    .tag("admin-analysis")

  val requestOperation: SecuredMutation[
    (Option[String], SeriesPlayerRadarOperationRequest),
    SeriesPlayerRadarOperationResponse,
  ] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .post
    .in("api" / "admin" / "series-analysis" / "radar" / "operations")
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[SeriesPlayerRadarOperationRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(statusCode(StatusCode.Accepted))
    .out(jsonBody[SeriesPlayerRadarOperationResponse])
    .out(noStore)
    .tag("admin-analysis")
