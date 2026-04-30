package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.{PublicEndpoint, *}
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object OcrJobEndpoints:
  type CreateInput = (Option[String], Option[String], CreateOcrJobRequest)
  type CancelInput = (String, Option[String], Option[String])

  val create: PublicEndpoint[CreateInput, ErrorInfo, CreateOcrJobResponse, Any] = endpoint.post
    .in("api" / "ocr-jobs").in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token")).in(jsonBody[CreateOcrJobRequest])
    .errorOut(CommonEndpoint.errorOut).out(jsonBody[CreateOcrJobResponse]).tag("ocr")

  val get: PublicEndpoint[(String, Option[String]), ErrorInfo, OcrJobResponse, Any] = endpoint.get
    .in("api" / "ocr-jobs" / path[String]("jobId")).in(header[Option[String]]("X-Dev-User"))
    .errorOut(CommonEndpoint.errorOut).out(jsonBody[OcrJobResponse]).tag("ocr")

  val cancel: PublicEndpoint[CancelInput, ErrorInfo, CancelOcrJobResponse, Any] = endpoint.delete
    .in("api" / "ocr-jobs" / path[String]("jobId")).in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token")).errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CancelOcrJobResponse]).tag("ocr")
