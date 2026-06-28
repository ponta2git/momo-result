package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

import momo.api.domain.OcrDraft

object OcrDraftEndpoints:
  val get: CommonEndpoint.SecuredRead[String, OcrDraftResponse] =
    endpoint
      .get
      .in("api" / "ocr-drafts" / path[String]("draftId"))
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftResponse])
      .tag("ocr")

  val listByIds
      : CommonEndpoint.SecuredRead[String, OcrDraftListResponse] =
    endpoint
      .get
      .in("api" / "ocr-drafts")
      .in(query[String]("ids").description(s"1..${OcrDraft
          .MaxBulkIds
          .toString} comma-separated ids."))
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftListResponse])
      .tag("ocr")
