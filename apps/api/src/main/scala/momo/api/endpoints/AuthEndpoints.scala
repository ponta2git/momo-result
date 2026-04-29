package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.PublicEndpoint
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.*

object AuthEndpoints:
  val me: PublicEndpoint[Option[String], ErrorInfo, AuthMeResponse, Any] =
    endpoint.get
      .in("api" / "auth" / "me")
      .in(header[Option[String]]("X-Dev-User"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[AuthMeResponse])
      .tag("auth")
