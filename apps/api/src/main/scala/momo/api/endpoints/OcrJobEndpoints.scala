package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.http.ProblemDetails.ErrorInfo

object OcrJobEndpoints:
  type CreateInput = (Option[String], Option[String], Option[String], CreateOcrJobRequest)
  type CancelInput = (String, Option[String], Option[String])

  val create: PublicEndpoint[CreateInput, ErrorInfo, CreateOcrJobResponse, Any] = endpoint
    .post
    .in("api" / "ocr-jobs")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateOcrJobRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CreateOcrJobResponse])
    .tag("ocr")

  val get: PublicEndpoint[(String, Option[String]), ErrorInfo, OcrJobResponse, Any] = endpoint
    .get
    .in("api" / "ocr-jobs" / path[String]("jobId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[OcrJobResponse])
    .tag("ocr")

  val cancel: PublicEndpoint[CancelInput, ErrorInfo, CancelOcrJobResponse, Any] = endpoint
    .delete
    .in("api" / "ocr-jobs" / path[String]("jobId"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CancelOcrJobResponse])
    .tag("ocr")
