package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.http.ProblemDetails.ErrorInfo

object AuthEndpoints:
  val login: PublicEndpoint[Unit, ErrorInfo, String, Any] = endpoint
    .get
    .in("api" / "auth" / "login")
    .errorOut(CommonEndpoint.errorOut)
    .out(statusCode(sttp.model.StatusCode.Found))
    .out(header[String]("Location"))
    .tag("auth")
    .description("Start Discord OAuth login.")

  val callback: PublicEndpoint[(Option[String], Option[String]), ErrorInfo, String, Any] = endpoint
    .get
    .in("api" / "auth" / "callback")
    .in(query[Option[String]]("code"))
    .in(query[Option[String]]("state"))
    .errorOut(CommonEndpoint.errorOut)
    .out(statusCode(sttp.model.StatusCode.Found))
    .out(header[String]("Location"))
    .tag("auth")
    .description("Complete Discord OAuth login.")

  val logout: PublicEndpoint[Option[String], ErrorInfo, Unit, Any] = endpoint
    .post
    .in("api" / "auth" / "logout")
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(statusCode(sttp.model.StatusCode.NoContent))
    .tag("auth")

  val me: PublicEndpoint[Option[String], ErrorInfo, AuthMeResponse, Any] = endpoint
    .get
    .in("api" / "auth" / "me")
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AuthMeResponse])
    .tag("auth")
