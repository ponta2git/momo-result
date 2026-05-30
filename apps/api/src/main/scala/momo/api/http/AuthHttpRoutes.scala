package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.{
  Header, HttpRoutes, MediaType, Request, Response, ResponseCookie, SameSite, Status,
}
import org.slf4j.LoggerFactory
import org.typelevel.ci.CIString

import momo.api.auth.{
  AuthHeaderNames, CsrfTokenService, DiscordOAuthClient, OAuthProviderBackoff, OAuthStateCodec,
  RateLimiter, SessionService, SessionTokenHash,
}
import momo.api.config.{AppConfig, AppEnv, RedirectPath}
import momo.api.domain.ids.*
import momo.api.endpoints.{AuthMeResponse, AuthPaths, ProblemDetails}
import momo.api.errors.AppError
import momo.api.repositories.LoginAccountsRepository

private[http] object AuthHttpRoutes:
  private val logger = LoggerFactory.getLogger("momo.api.http.AuthHttpRoutes")

  def routes[F[_]: Async](
      config: AppConfig,
      oauth: DiscordOAuthClient[F],
      stateCodec: OAuthStateCodec[F],
      sessions: SessionService[F],
      csrf: CsrfTokenService,
      accounts: LoginAccountsRepository[F],
      rateLimiter: RateLimiter[F],
      callbackStateRateLimiter: RateLimiter[F],
      providerBackoff: OAuthProviderBackoff[F],
  ): HttpRoutes[F] =
    lazy val routes: HttpRoutes[F] = HttpRoutes.of[F] {
      case request if request.method.name == "GET" && path(request) == AuthPaths.LoginPath =>
        rateLimit(request).flatMap {
          case Left(response) => response
          case Right(_) =>
            for
              silent = request.uri.query.params.get(AuthPaths.SilentQuery).contains("1")
              next = request.uri.query.params.get(AuthPaths.NextQuery)
                .flatMap(RedirectPath.sanitize)
              state <- stateCodec.create(silent, next)
              location <- oauth.authorizationUrl(state, if silent then Some("none") else None)
              response <- redirect(location).map(_.addCookie(stateCookie(config, state)))
            yield response
        }

      case request if request.method.name == "GET" && path(request) == AuthPaths.CallbackPath =>
        rateLimit(request).flatMap {
          case Left(response) => response
          case Right(_) =>
            val params = request.uri.query.params
            val state = params.get(AuthPaths.StateQuery)
            val code = params.get(AuthPaths.CodeQuery)
            val oauthError = params.get(AuthPaths.ErrorQuery)
            val cookieState = request.cookies.find(_.name == config.auth.stateCookieName)
              .map(_.content)
            (state, cookieState) match
              case (Some(stateValue), Some(cookieValue)) if stateValue == cookieValue =>
                rateLimitCallbackState(stateValue).flatMap {
                  case Left(response) => response
                      .map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                  case Right(_) => stateCodec.validate(stateValue).flatMap {
                      case None => callbackProblem(
                          "state_invalid_or_expired",
                          AppError.Forbidden("OAuth state is invalid or expired."),
                        ).map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                      case Some(context) => oauthError match
                          case Some(_) if context.silent =>
                            Async[F].delay(logger.warn(
                              "auth_callback_rejected reason=provider_denied_silent"
                            )) *> redirect(interactiveLoginPath(context.redirectPath))
                              .map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                          case Some(_) => callbackProblem(
                              "provider_denied",
                              AppError.Forbidden("Discord OAuth was cancelled or denied."),
                            ).map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                          case None => code match
                              case Some(codeValue) => fetchUserWithBackoff(codeValue).flatMap {
                                  case Left(error) => callbackProblem("provider_error", error).map(
                                      _.addCookie(clearCookie(config.auth.stateCookieName, config))
                                    )
                                  case Right(discordUser) => UserId.fromString(discordUser.id) match
                                      case Left(_) => callbackProblem(
                                          "invalid_discord_user_id",
                                          AppError.Forbidden(
                                            "This Discord user is not allowed to log in."
                                          ),
                                        ).map(_.addCookie(
                                          clearCookie(config.auth.stateCookieName, config)
                                        ))
                                      case Right(userId) => accounts.findByDiscordUserId(userId)
                                          .flatMap {
                                            case None => callbackProblem(
                                                "discord_user_not_allowed",
                                                AppError.Forbidden(
                                                  "This Discord user is not allowed to log in."
                                                ),
                                              ).map(_.addCookie(
                                                clearCookie(config.auth.stateCookieName, config)
                                              ))
                                            case Some(account) if !account.loginEnabled =>
                                              callbackProblem(
                                                "login_disabled",
                                                AppError.Forbidden(
                                                  "This account is not allowed to log in."
                                                ),
                                              ).map(_.addCookie(
                                                clearCookie(config.auth.stateCookieName, config)
                                              ))
                                            case Some(account) => sessions.create(account)
                                                .flatMap { session =>
                                                  val event =
                                                    s"auth_login_completed accountId=${account.id
                                                        .value}"
                                                  Async[F].delay(logger.info(event)) *> redirect(
                                                    context.redirectPath
                                                      .getOrElse(config.auth.callbackRedirectPath)
                                                  ).map(
                                                    _.addCookie(
                                                      sessionCookie(config, session.cookieValue)
                                                    ).addCookie(clearCookie(
                                                      config.auth.stateCookieName,
                                                      config,
                                                    ))
                                                  )
                                                }
                                          }
                                }
                              case None => callbackProblem(
                                  "missing_code",
                                  AppError
                                    .Forbidden("OAuth callback is missing or has mismatched state."),
                                ).map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
                    }
                }
              case _ => callbackProblem(
                  "state_mismatch",
                  AppError.Forbidden("OAuth callback is missing or has mismatched state."),
                ).map(_.addCookie(clearCookie(config.auth.stateCookieName, config)))
        }

      case request if request.method.name == "POST" && path(request) == AuthPaths.LogoutPath =>
        val sessionId = request.cookies.find(_.name == config.auth.sessionCookieName).map(_.content)
        sessions.authenticate(sessionId).flatMap {
          case Left(error) => problem(error)
          case Right(authenticated) => csrf.verify(
              authenticated.session,
              request.headers.get(CIString(CsrfMiddleware.HeaderName)).flatMap(_.head.value.some),
            ) match
              case Left(error) => problem(error)
              case Right(_) => sessions.delete(authenticated.session.idHash) *>
                  noContent.map(_.addCookie(clearCookie(config.auth.sessionCookieName, config)))
        }

      case request if request.method.name == "GET" && path(request) == AuthPaths.MePath =>
        config.appEnv match
          case AppEnv.Dev | AppEnv.Test => devAccountHeader(request) match
              case Some(accountId) => AccountId.fromString(accountId) match
                  case Left(_) => problem(
                      AppError.Forbidden("Account header is not one of the allowed accounts.")
                    )
                  case Right(parsedAccountId) => accounts.find(parsedAccountId).flatMap {
                      case Some(account) if account.loginEnabled =>
                        json(AuthMeResponse(
                          accountId = account.id.value,
                          displayName = account.displayName,
                          isAdmin = account.isAdmin,
                          memberId = account.playerMemberId.map(_.value),
                          csrfToken = Some(CsrfMiddleware.DevToken),
                        ))
                      case Some(_) =>
                        problem(AppError.Forbidden("This account is not allowed to log in."))
                      case None => problem(
                          AppError.Forbidden("Account header is not one of the allowed accounts.")
                        )
                    }
              case None => sessionAuthMe(request)
          case AppEnv.Prod => sessionAuthMe(request)
    }

    def path(request: Request[F]): String = request.uri.path.renderString

    def devAccountHeader(request: Request[F]): Option[String] = request.headers
      .get(CIString(AuthHeaderNames.AccountId)).map(_.head.value)

    def redirect(location: String): F[Response[F]] = Response[F](Status.Found)
      .putHeaders(Header.Raw(CIString("Location"), location)).pure[F]

    def interactiveLoginPath(next: Option[String]): String = next match
      case None => AuthPaths.LoginPath
      case Some(path) => s"${AuthPaths.LoginPath}?next=${RedirectPath.encodeQueryValue(path)}"

    def noContent: F[Response[F]] = Response[F](Status.NoContent).pure[F]

    def json(body: AuthMeResponse): F[Response[F]] = Response[F](Status.Ok).withEntity(body.asJson)
      .putHeaders(`Content-Type`(MediaType.application.json)).pure[F]

    def sessionAuthMe(request: Request[F]): F[Response[F]] =
      val sessionId = request.cookies.find(_.name == config.auth.sessionCookieName).map(_.content)
      sessions.authenticate(sessionId).flatMap {
        case Left(error) => problem(error)
        case Right(authenticated) => json(AuthMeResponse(
            accountId = authenticated.account.accountId.value,
            displayName = authenticated.account.displayName,
            isAdmin = authenticated.account.isAdmin,
            memberId = authenticated.account.playerMemberId.map(_.value),
            csrfToken = Some(csrf.issue(authenticated)),
          ))
      }

    def rateLimit(request: Request[F]): F[Either[F[Response[F]], Unit]] =
      val key = clientKey(request)
      rateLimiter.allow(key).flatMap {
        case true => Async[F].pure(Right(()))
        case false => Async[F].delay(logger.warn("auth_login_rate_limited")) *> Async[F].pure(Left(
            problem(AppError.TooManyRequests("Too many login attempts. Try again later."))
          ))
      }

    def rateLimitCallbackState(state: String): F[Either[F[Response[F]], Unit]] = SessionTokenHash
      .sha256[F](state).flatMap { stateHash =>
        callbackStateRateLimiter.allow(stateHash).flatMap {
          case true => Async[F].pure(Right(()))
          case false => Async[F].delay(logger.warn("auth_callback_state_rate_limited")) *>
              Async[F].pure(Left(problem(
                AppError.TooManyRequests("Too many OAuth callback attempts. Start login again.")
              )))
        }
      }

    def fetchUserWithBackoff(code: String): F[Either[AppError, momo.api.auth.DiscordUser]] =
      providerBackoff.isBlocked.flatMap {
        case true => Async[F].delay(logger.warn("auth_oauth_provider_backoff_active")) *>
            AppError.DependencyFailed(
              "Discord OAuth provider is temporarily unavailable. Try again later."
            ).asLeft[momo.api.auth.DiscordUser].pure[F]
        case false => oauth.fetchUser(code).flatTap {
            case Left(error) => providerBackoff.recordFailure(error).flatMap { opened =>
                if opened then Async[F].delay(logger.warn("auth_oauth_provider_backoff_opened"))
                else Async[F].unit
              }
            case Right(_) => providerBackoff.recordSuccess
          }
      }

    def callbackProblem(reason: String, error: AppError): F[Response[F]] = Async[F]
      .delay(logger.warn(s"auth_callback_rejected reason=$reason problemCode=${error.code}")) *>
      problem(error)

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
