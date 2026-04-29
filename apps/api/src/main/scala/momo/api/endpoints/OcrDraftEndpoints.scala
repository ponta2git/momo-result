package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.PublicEndpoint
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.*

object OcrDraftEndpoints:
  val get: PublicEndpoint[(String, Option[String]), ErrorInfo, OcrDraftResponse, Any] =
    endpoint.get
      .in("api" / "ocr-drafts" / path[String]("draftId"))
      .in(header[Option[String]]("X-Dev-User"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[OcrDraftResponse])
      .tag("ocr")
