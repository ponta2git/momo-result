package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.http.ProblemDetails.ErrorInfo

object OcrDraftEndpoints:
  val get: PublicEndpoint[(String, Option[String]), ErrorInfo, OcrDraftResponse, Any] = endpoint
    .get
    .in("api" / "ocr-drafts" / path[String]("draftId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[OcrDraftResponse])
    .tag("ocr")

  val listByIds: PublicEndpoint[(String, Option[String]), ErrorInfo, OcrDraftListResponse, Any] =
    endpoint
      .get
      .in("api" / "ocr-drafts")
      .in(query[String]("ids"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftListResponse])
      .tag("ocr")
