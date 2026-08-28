package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object OcrJobEndpoints:
  final case class CreateInput(
      idempotencyKey: Option[String],
      requestId: Option[String],
      request: CreateOcrJobRequest,
  )

  private val createInput: EndpointInput[CreateInput] = CommonEndpoint
    .idempotencyKeyHeader
    .and(CommonEndpoint.requestIdHeader)
    .and(jsonBody[CreateOcrJobRequest])
    .mapTo[CreateInput]

  type CancelInput = (String, Option[String])

  val create: CommonEndpoint.SecuredMutation[
    CreateInput,
    CreateOcrJobResponse,
  ] = endpoint
    .post
    .in("api" / "ocr-jobs")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(createInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CreateOcrJobResponse])
    .tag("ocr")

  val get: CommonEndpoint.SecuredRead[String, OcrJobResponse] = endpoint
    .get
    .in("api" / "ocr-jobs" / path[String]("jobId"))
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[OcrJobResponse])
    .tag("ocr")

  val cancel: CommonEndpoint.SecuredMutation[CancelInput, CancelOcrJobResponse] = endpoint
    .delete
    .in("api" / "ocr-jobs" / path[String]("jobId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CancelOcrJobResponse])
    .tag("ocr")
