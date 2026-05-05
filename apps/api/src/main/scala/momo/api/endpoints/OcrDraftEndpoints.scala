package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object OcrDraftEndpoints:
  val get: PublicEndpoint[(String, Option[String]), ProblemResponse, OcrDraftResponse, Any] =
    endpoint
      .get
      .in("api" / "ocr-drafts" / path[String]("draftId"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftResponse])
      .tag("ocr")

  val listByIds
      : PublicEndpoint[(String, Option[String]), ProblemResponse, OcrDraftListResponse, Any] =
    endpoint
      .get
      .in("api" / "ocr-drafts")
      .in(query[String]("ids"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftListResponse])
      .tag("ocr")
