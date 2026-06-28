package momo.api.endpoints

import sttp.model.headers.{Cookie as SttpCookie, CookieWithMeta}
import sttp.model.{HeaderNames, StatusCode}
import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.model.ServerRequest

object AuthEndpoints:
  type AuthProblemResponse = (StatusCode, ProblemDetails, List[CookieWithMeta])
  type RedirectOutput = (String, List[CookieWithMeta])
  type LoginInput = (Option[String], Option[String], ServerRequest)
  type CallbackInput =
    (Option[String], Option[String], Option[String], List[SttpCookie], ServerRequest)
  type LogoutSecurityInput = (Option[String], List[SttpCookie])
  type MeSecurityInput = (Option[String], List[SttpCookie])

  private val errorOut = statusCode.and(jsonBody[ProblemDetails]).and(setCookies)
  private val request = extractFromRequest(identity[ServerRequest])

  val login: PublicEndpoint[LoginInput, AuthProblemResponse, RedirectOutput, Any] =
    endpoint
      .get
      .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Login)
      .in(query[Option[String]](AuthPaths.SilentQuery))
      .in(query[Option[String]](AuthPaths.NextQuery))
      .in(request)
      .errorOut(errorOut)
      .out(statusCode(StatusCode.Found))
      .out(header[String](HeaderNames.Location))
      .out(setCookies)
      .tag("auth")
      .description("Start Discord OAuth login.")

  val callback: PublicEndpoint[
    CallbackInput,
    AuthProblemResponse,
    RedirectOutput,
    Any,
  ] = endpoint
    .get
    .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Callback)
    .in(query[Option[String]](AuthPaths.CodeQuery))
    .in(query[Option[String]](AuthPaths.StateQuery))
    .in(query[Option[String]](AuthPaths.ErrorQuery))
    .in(cookies)
    .in(request)
    .errorOut(errorOut)
    .out(statusCode(StatusCode.Found))
    .out(header[String](HeaderNames.Location))
    .out(setCookies)
    .tag("auth")
    .description("Complete Discord OAuth login.")

  val logout: Endpoint[LogoutSecurityInput, Unit, AuthProblemResponse, List[CookieWithMeta], Any] =
    endpoint
      .post
      .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Logout)
      .securityIn(CommonEndpoint.csrfHeader.and(cookies))
      .errorOut(errorOut)
      .out(statusCode(StatusCode.NoContent))
      .out(setCookies)
      .tag("auth")

  val me: Endpoint[MeSecurityInput, Unit, AuthProblemResponse, AuthMeResponse, Any] = endpoint
    .get
    .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Me)
    .securityIn(CommonEndpoint.accountHeader.and(cookies))
    .errorOut(errorOut)
    .out(jsonBody[AuthMeResponse])
    .tag("auth")
