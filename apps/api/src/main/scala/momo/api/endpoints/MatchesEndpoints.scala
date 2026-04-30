package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.{PublicEndpoint, *}
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object MatchesEndpoints:
  type ConfirmInput = (Option[String], Option[String], ConfirmMatchRequest)

  val confirm: PublicEndpoint[ConfirmInput, ErrorInfo, ConfirmMatchResponse, Any] = endpoint
    .post
    .in("api" / "matches")
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
    .in(jsonBody[ConfirmMatchRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[ConfirmMatchResponse])
    .tag("matches")
