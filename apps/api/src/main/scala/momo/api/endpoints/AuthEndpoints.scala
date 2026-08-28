package momo.api.endpoints

import sttp.model.headers.{Cookie as SttpCookie, CookieWithMeta}
import sttp.model.{HeaderNames, StatusCode}
import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.model.ServerRequest

object AuthEndpoints:
  final case class AuthProblemResponse(
      status: StatusCode,
      body: ProblemDetails,
      cookies: List[CookieWithMeta],
  )
  final case class RedirectOutput(location: String, cookies: List[CookieWithMeta])
  final case class LoginInput(
      silent: Option[String],
      next: Option[String],
      request: ServerRequest,
  )
  final case class CallbackInput(
      code: Option[String],
      state: Option[String],
      oauthError: Option[String],
      cookies: List[SttpCookie],
      request: ServerRequest,
  )
  final case class LogoutSecurityInput(csrfToken: Option[String], cookies: List[SttpCookie])
  final case class MeSecurityInput(accountHeader: Option[String], cookies: List[SttpCookie])

  private val errorOut: EndpointOutput[AuthProblemResponse] = statusCode
    .and(jsonBody[ProblemDetails])
    .and(setCookies)
    .mapTo[AuthProblemResponse]
  private val redirectOut: EndpointOutput[RedirectOutput] = header[String](HeaderNames.Location)
    .and(setCookies)
    .mapTo[RedirectOutput]
  private val request = extractFromRequest(identity[ServerRequest])
  private val loginInput: EndpointInput[LoginInput] = query[Option[String]](AuthPaths.SilentQuery)
    .and(query[Option[String]](AuthPaths.NextQuery))
    .and(request)
    .mapTo[LoginInput]
  private val callbackInput: EndpointInput[CallbackInput] = query[Option[String]](
    AuthPaths.CodeQuery
  ).and(query[Option[String]](AuthPaths.StateQuery))
    .and(query[Option[String]](AuthPaths.ErrorQuery))
    .and(cookies)
    .and(request)
    .mapTo[CallbackInput]
  private val logoutSecurityInput: EndpointInput[LogoutSecurityInput] = CommonEndpoint
    .csrfHeader
    .and(cookies)
    .mapTo[LogoutSecurityInput]
  private val meSecurityInput: EndpointInput[MeSecurityInput] = CommonEndpoint
    .accountHeader
    .and(cookies)
    .mapTo[MeSecurityInput]

  val login: PublicEndpoint[LoginInput, AuthProblemResponse, RedirectOutput, Any] =
    endpoint
      .get
      .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Login)
      .in(loginInput)
      .errorOut(errorOut)
      .out(statusCode(StatusCode.Found))
      .out(redirectOut)
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
    .in(callbackInput)
    .errorOut(errorOut)
    .out(statusCode(StatusCode.Found))
    .out(redirectOut)
    .tag("auth")
    .description("Complete Discord OAuth login.")

  val logout: Endpoint[LogoutSecurityInput, Unit, AuthProblemResponse, List[CookieWithMeta], Any] =
    endpoint
      .post
      .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Logout)
      .securityIn(logoutSecurityInput)
      .errorOut(errorOut)
      .out(statusCode(StatusCode.NoContent))
      .out(setCookies)
      .tag("auth")

  val me: Endpoint[MeSecurityInput, Unit, AuthProblemResponse, AuthMeResponse, Any] = endpoint
    .get
    .in(AuthPaths.Api / AuthPaths.Auth / AuthPaths.Me)
    .securityIn(meSecurityInput)
    .errorOut(errorOut)
    .out(jsonBody[AuthMeResponse])
    .tag("auth")
