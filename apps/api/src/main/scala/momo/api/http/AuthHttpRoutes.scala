package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import io.circe.syntax.*
import momo.api.auth.{
  CsrfTokenService, DiscordOAuthClient, LoginRateLimiter, OAuthStateCodec, SessionService,
}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.domain.ids.*
import momo.api.endpoints.AuthMeResponse
import momo.api.errors.AppError
import momo.api.repositories.MembersRepository
import org.http4s.{
  Header, HttpRoutes, MediaType, Request, Response, ResponseCookie, SameSite, Status,
}
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.typelevel.ci.CIString

private[http] object AuthHttpRoutes:
  def routes[F[_]: Async](
      config: AppConfig,
      oauth: DiscordOAuthClient[F],
      stateCodec: OAuthStateCodec[F],
      sessions: SessionService[F],
      csrf: CsrfTokenService,
      members: MembersRepository[F],
      rateLimiter: LoginRateLimiter[F],
  ): HttpRoutes[F] =
    lazy val routes: HttpRoutes[F] = HttpRoutes.of[F] {
      case request if request.method.name == "GET" && path(request) == "/api/auth/login" =>
        rateLimit(request).flatMap {
          case Left(response) => response
          case Right(_) =>
            for
              state <- stateCodec.create
              location <- oauth.authorizationUrl(state)
              response <- redirect(location).map(_.addCookie(stateCookie(config, state)))
            yield response
        }

      case request if request.method.name == "GET" && path(request) == "/api/auth/callback" =>
        rateLimit(request).flatMap {
          case Left(response) => response
          case Right(_) =>
            val params = request.uri.query.params
            val state = params.get("state")
            val code = params.get("code")
            val cookieState = request.cookies.find(_.name == config.auth.stateCookieName)
              .map(_.content)
            (state, code, cookieState) match
              case (Some(stateValue), Some(codeValue), Some(cookieValue))
                  if stateValue == cookieValue =>
                stateCodec.validate(stateValue).flatMap {
                  case false => problem(AppError.Forbidden("OAuth state is invalid or expired."))
                  case true => oauth.fetchUser(codeValue).flatMap {
                      case Left(error) => problem(error)
                          .map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                      case Right(discordUser) => members.findByDiscordUserId(discordUser.id)
                          .flatMap {
                            case None => problem(
                                AppError.Forbidden("This Discord user is not allowed to log in.")
                              ).map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                            case Some(member) => sessions.create(member).flatMap { session =>
                                redirect(config.auth.callbackRedirectPath).map(
                                  _.addCookie(sessionCookie(config, session.id))
                                    .addCookie(clearCookie(config.auth.stateCookieName, config))
                                )
                              }
                          }
                    }
                }
              case _ =>
                problem(AppError.Forbidden("OAuth callback is missing or has mismatched state."))
                  .map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
        }

      case request if request.method.name == "POST" && path(request) == "/api/auth/logout" =>
        val sessionId = request.cookies.find(_.name == config.auth.sessionCookieName).map(_.content)
        sessions.authenticate(sessionId).flatMap {
          case Left(error) => problem(error)
          case Right(authenticated) => csrf.verify(
              authenticated.session,
              request.headers.get(CIString(CsrfMiddleware.HeaderName)).flatMap(_.head.value.some),
            ) match
              case Left(error) => problem(error)
              case Right(_) => sessions.delete(authenticated.session.id) *>
                  noContent.map(_.addCookie(clearCookie(config.auth.sessionCookieName, config)))
        }

      case request if request.method.name == "GET" && path(request) == "/api/auth/me" =>
        config.appEnv match
          case AppEnv.Dev | AppEnv.Test => request.headers.get(CIString("X-Dev-User"))
              .flatMap(_.head.value.some) match
              case Some(memberId) => members.find(memberId).flatMap {
                  case Some(member) => json(AuthMeResponse(
                      member.id,
                      member.displayName,
                      csrfToken = Some(CsrfMiddleware.DevToken),
                    ))
                  case None =>
                    problem(AppError.Forbidden("X-Dev-User is not one of the allowed members."))
                }
              case None => problem(AppError.Unauthorized())
          case AppEnv.Prod =>
            val sessionId = request.cookies.find(_.name == config.auth.sessionCookieName)
              .map(_.content)
            sessions.authenticate(sessionId).flatMap {
              case Left(error) => problem(error)
              case Right(authenticated) => json(AuthMeResponse(
                  memberId = authenticated.member.memberId.value,
                  displayName = authenticated.member.displayName,
                  csrfToken = Some(csrf.issue(authenticated.session)),
                ))
            }
    }

    def path(request: Request[F]): String = request.uri.path.renderString

    def redirect(location: String): F[Response[F]] = Response[F](Status.Found)
      .putHeaders(Header.Raw(CIString("Location"), location)).pure[F]

    def noContent: F[Response[F]] = Response[F](Status.NoContent).pure[F]

    def json(body: AuthMeResponse): F[Response[F]] = Response[F](Status.Ok).withEntity(body.asJson)
      .putHeaders(`Content-Type`(MediaType.application.json)).pure[F]

    def rateLimit(request: Request[F]): F[Either[F[Response[F]], Unit]] = rateLimiter
      .allow(clientKey(request)).map {
        case true => Right(())
        case false =>
          Left(problem(AppError.TooManyRequests("Too many login attempts. Try again later.")))
      }

    def problem(error: AppError): F[Response[F]] =
      val (status, body) = ProblemDetails.from(error)
      Response[F](Status.fromInt(status.code).getOrElse(Status.InternalServerError))
        .withEntity(body.asJson).putHeaders(`Content-Type`(MediaType.application.json)).pure[F]

    def sessionCookie(config: AppConfig, value: String): ResponseCookie =
      baseCookie(config.auth.sessionCookieName, value, config)
        .copy(maxAge = Some(config.auth.sessionTtl.toSeconds))

    def stateCookie(config: AppConfig, value: String): ResponseCookie =
      baseCookie(config.auth.stateCookieName, value, config)
        .copy(maxAge = Some(config.auth.stateTtl.toSeconds))

    def clearCookie(name: String, config: AppConfig): ResponseCookie = baseCookie(name, "", config)
      .copy(maxAge = Some(0L))

    def baseCookie(name: String, value: String, config: AppConfig): ResponseCookie = ResponseCookie(
      name = name,
      content = value,
      path = Some("/"),
      sameSite = Some(SameSite.Lax),
      secure = config.auth.useSecureCookies,
      httpOnly = true,
    )

    def clientKey(request: Request[F]): String = ClientIp.of(request)

    routes
