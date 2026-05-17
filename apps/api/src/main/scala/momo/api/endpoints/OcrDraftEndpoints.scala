package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.domain.OcrDraft
import momo.api.endpoints.ProblemDetails.ProblemResponse

object OcrDraftEndpoints:
  val get: PublicEndpoint[(String, Option[String]), ProblemResponse, OcrDraftResponse, Any] =
    endpoint
      .get
      .in("api" / "ocr-drafts" / path[String]("draftId"))
      .in(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftResponse])
      .tag("ocr")

  val listByIds
      : PublicEndpoint[(String, Option[String]), ProblemResponse, OcrDraftListResponse, Any] =
    endpoint
      .get
      .in("api" / "ocr-drafts")
      .in(query[String]("ids").description(s"1..${OcrDraft
          .MaxBulkIds
          .toString} comma-separated ids."))
      .in(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftListResponse])
      .tag("ocr")
