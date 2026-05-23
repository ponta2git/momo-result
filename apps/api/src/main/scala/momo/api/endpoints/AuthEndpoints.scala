package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object AuthEndpoints:
  val login: PublicEndpoint[(Option[String], Option[String]), ProblemResponse, String, Any] =
    endpoint
      .get
      .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Login)
      .in(query[Option[String]]("silent"))
      .in(query[Option[String]]("next"))
      .errorOut(CommonEndpoint.errorOut)
      .out(statusCode(sttp.model.StatusCode.Found))
      .out(header[String]("Location"))
      .tag("auth")
      .description("Start Discord OAuth login.")

  val callback: PublicEndpoint[
    (Option[String], Option[String], Option[String]),
    ProblemResponse,
    String,
    Any,
  ] = endpoint
    .get
    .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Callback)
    .in(query[Option[String]]("code"))
    .in(query[Option[String]]("state"))
    .in(query[Option[String]]("error"))
    .errorOut(CommonEndpoint.errorOut)
    .out(statusCode(sttp.model.StatusCode.Found))
    .out(header[String]("Location"))
    .tag("auth")
    .description("Complete Discord OAuth login.")

  val logout: PublicEndpoint[Option[String], ProblemResponse, Unit, Any] = endpoint
    .post
    .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Logout)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(statusCode(sttp.model.StatusCode.NoContent))
    .tag("auth")

  val me: PublicEndpoint[Option[String], ProblemResponse, AuthMeResponse, Any] = endpoint
    .get
    .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Me)
    .in(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AuthMeResponse])
    .tag("auth")
