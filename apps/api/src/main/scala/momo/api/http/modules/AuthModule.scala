package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.model.headers.{Cookie as SttpCookie, CookieWithMeta}
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.{
  AuthenticatedSession,
  CsrfTokenService,
  DiscordOAuthClient,
  OAuthProviderBackoff,
  OAuthStateCodec,
  RateLimiter,
  SessionService,
  SessionTokenHash
}
import momo.api.config.{AppConfig, AppEnv, RedirectPath}
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.endpoints.{AuthEndpoints, AuthMeResponse, AuthPaths, ProblemDetails}
import momo.api.errors.AppError
import momo.api.http.{ClientIp, CsrfMiddleware}
import momo.api.repositories.LoginAccountsRepository

object AuthModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.AuthModule")

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
  ): List[ServerEndpoint[Any, F]] = List(
    AuthEndpoints.login.serverLogic { case (silentParam, nextParam, request) =>
      login(
        silent = silentParam.contains("1"),
        next = nextParam.flatMap(RedirectPath.sanitize),
        clientKey = ClientIp.of(request),
        config = config,
        oauth = oauth,
        stateCodec = stateCodec,
        rateLimiter = rateLimiter,
      )
    },
    AuthEndpoints.callback.serverLogic { case (code, state, oauthError, cookies, request) =>
      callback(
        code = code,
        state = state,
        oauthError = oauthError,
        cookies = cookies,
        clientKey = ClientIp.of(request),
        config = config,
        oauth = oauth,
        stateCodec = stateCodec,
        sessions = sessions,
        accounts = accounts,
        rateLimiter = rateLimiter,
        callbackStateRateLimiter = callbackStateRateLimiter,
        providerBackoff = providerBackoff,
      )
    },
    AuthEndpoints.logout
      .serverSecurityLogic { case (csrfToken, cookies) =>
        authenticateLogout(config, sessions, csrf, csrfToken, cookies)
      }
      .serverLogic(authenticated =>
        _ =>
          sessions.delete(authenticated.session.idHash).as(Right(List(clearSessionCookie(config))))
      ),
    AuthEndpoints.me
      .serverSecurityLogic { case (accountHeader, cookies) =>
        authenticateMe(config, sessions, csrf, accounts, accountHeader, cookies)
      }
      .serverLogic(authMe => _ => Async[F].pure(Right(authMe))),
  )

  private def login[F[_]: Async](
      silent: Boolean,
      next: Option[String],
      clientKey: String,
      config: AppConfig,
      oauth: DiscordOAuthClient[F],
      stateCodec: OAuthStateCodec[F],
      rateLimiter: RateLimiter[F],
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthEndpoints.RedirectOutput]] =
    rateLimit(rateLimiter, clientKey).flatMap {
      case Left(problem) => Async[F].pure(Left(problem))
      case Right(_) =>
        for
          state <- stateCodec.create(silent, next)
          location <- oauth.authorizationUrl(state, if silent then Some("none") else None)
        yield Right((location, List(stateCookie(config, state))))
    }

  private def callback[F[_]: Async](
      code: Option[String],
      state: Option[String],
      oauthError: Option[String],
      cookies: List[SttpCookie],
      clientKey: String,
      config: AppConfig,
      oauth: DiscordOAuthClient[F],
      stateCodec: OAuthStateCodec[F],
      sessions: SessionService[F],
      accounts: LoginAccountsRepository[F],
      rateLimiter: RateLimiter[F],
      callbackStateRateLimiter: RateLimiter[F],
      providerBackoff: OAuthProviderBackoff[F],
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthEndpoints.RedirectOutput]] =
    rateLimit(rateLimiter, clientKey).flatMap {
      case Left(problem) => Async[F].pure(Left(problem))
      case Right(_) =>
        val cookieState = cookieValue(cookies, config.auth.stateCookieName)
        (state, cookieState) match
          case (Some(stateValue), Some(cookieValue)) if stateValue == cookieValue =>
            rateLimitCallbackState(callbackStateRateLimiter, stateValue, config).flatMap {
              case Left(problem) => Async[F].pure(Left(problem))
              case Right(_) => stateCodec.validate(stateValue).flatMap {
                  case None => callbackProblem(
                      config,
                      "state_invalid_or_expired",
                      AppError.Forbidden("OAuth state is invalid or expired."),
                    )
                  case Some(context) => oauthError match
                      case Some(_) if context.silent =>
                        Async[F].delay(logger.warn(
                          "auth_callback_rejected reason=provider_denied_silent"
                        )) *> Async[F].pure(Right((
                          interactiveLoginPath(context.redirectPath),
                          List(clearStateCookie(config)),
                        )))
                      case Some(_) => callbackProblem(
                          config,
                          "provider_denied",
                          AppError.Forbidden("Discord OAuth was cancelled or denied."),
                        )
                      case None => code match
                          case Some(codeValue) => fetchUserWithBackoff(
                              oauth,
                              providerBackoff,
                              codeValue,
                            ).flatMap {
                              case Left(error) => callbackProblem(config, "provider_error", error)
                              case Right(discordUser) => UserId.fromString(discordUser.id) match
                                  case Left(_) => callbackProblem(
                                      config,
                                      "invalid_discord_user_id",
                                      AppError
                                        .Forbidden("This Discord user is not allowed to log in."),
                                    )
                                  case Right(userId) => accounts.findByDiscordUserId(userId)
                                      .flatMap {
                                        case None => callbackProblem(
                                            config,
                                            "discord_user_not_allowed",
                                            AppError.Forbidden(
                                              "This Discord user is not allowed to log in."
                                            ),
                                          )
                                        case Some(account) if !account.loginEnabled =>
                                          callbackProblem(
                                            config,
                                            "login_disabled",
                                            AppError
                                              .Forbidden("This account is not allowed to log in."),
                                          )
                                        case Some(account) => sessions.create(account)
                                            .flatMap { session =>
                                              val event = s"auth_login_completed accountId=${account
                                                  .id.value}"
                                              Async[F].delay(logger.info(event)).as(Right((
                                                context.redirectPath
                                                  .getOrElse(config.auth.callbackRedirectPath),
                                                List(
                                                  sessionCookie(config, session.cookieValue),
                                                  clearStateCookie(config),
                                                ),
                                              )))
                                            }
                                      }
                            }
                          case None => callbackProblem(
                              config,
                              "missing_code",
                              AppError
                                .Forbidden("OAuth callback is missing or has mismatched state."),
                            )
                }
            }
          case _ => callbackProblem(
              config,
              "state_mismatch",
              AppError.Forbidden("OAuth callback is missing or has mismatched state."),
            )
    }

  private def authenticateLogout[F[_]: Async](
      config: AppConfig,
      sessions: SessionService[F],
      csrf: CsrfTokenService,
      csrfToken: Option[String],
      cookies: List[SttpCookie],
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthenticatedSession]] =
    sessions.authenticate(cookieValue(cookies, config.auth.sessionCookieName)).map {
      case Left(error) => Left(authProblem(error, List(clearSessionCookie(config))))
      case Right(authenticated) => csrf.verify(authenticated.session, csrfToken) match
          case Left(error) => Left(authProblem(error, Nil))
          case Right(_) => Right(authenticated)
    }

  private def authenticateMe[F[_]: Async](
      config: AppConfig,
      sessions: SessionService[F],
      csrf: CsrfTokenService,
      accounts: LoginAccountsRepository[F],
      accountHeader: Option[String],
      cookies: List[SttpCookie],
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthMeResponse]] = config.appEnv match
    case AppEnv.Dev | AppEnv.Test => accountHeader match
        case Some(accountId) => AccountId.fromString(accountId) match
            case Left(_) =>
              Async[F].pure(Left(authProblem(
                AppError.Forbidden("Account header is not one of the allowed accounts."),
                Nil,
              )))
            case Right(parsedAccountId) => accounts.find(parsedAccountId).map {
                case Some(account) if account.loginEnabled =>
                  Right(AuthMeResponse(
                    accountId = account.id.value,
                    displayName = account.displayName,
                    isAdmin = account.isAdmin,
                    memberId = account.playerMemberId.map(_.value),
                    csrfToken = Some(CsrfMiddleware.DevToken),
                  ))
                case Some(_) =>
                  Left(authProblem(
                    AppError.Forbidden("This account is not allowed to log in."),
                    Nil,
                  ))
                case None => Left(authProblem(
                    AppError.Forbidden("Account header is not one of the allowed accounts."),
                    Nil,
                  ))
              }
        case None => sessionAuthMe(config, sessions, csrf, cookies)
    case AppEnv.Prod => sessionAuthMe(config, sessions, csrf, cookies)

  private def sessionAuthMe[F[_]: Async](
      config: AppConfig,
      sessions: SessionService[F],
      csrf: CsrfTokenService,
      cookies: List[SttpCookie],
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthMeResponse]] =
    sessions.authenticate(cookieValue(cookies, config.auth.sessionCookieName)).map {
      case Left(error) => Left(authProblem(error, Nil))
      case Right(authenticated) => Right(AuthMeResponse(
          accountId = authenticated.account.accountId.value,
          displayName = authenticated.account.displayName,
          isAdmin = authenticated.account.isAdmin,
          memberId = authenticated.account.playerMemberId.map(_.value),
          csrfToken = Some(csrf.issue(authenticated)),
        ))
    }

  private def rateLimit[F[_]: Async](
      rateLimiter: RateLimiter[F],
      clientKey: String,
  ): F[Either[AuthEndpoints.AuthProblemResponse, Unit]] =
    rateLimiter.allow(clientKey).flatMap {
      case true => Async[F].pure(Right(()))
      case false => Async[F].delay(logger.warn("auth_login_rate_limited")).as(Left(authProblem(
          AppError.TooManyRequests("Too many login attempts. Try again later."),
          Nil,
        )))
    }

  private def rateLimitCallbackState[F[_]: Async](
      rateLimiter: RateLimiter[F],
      state: String,
      config: AppConfig,
  ): F[Either[AuthEndpoints.AuthProblemResponse, Unit]] = SessionTokenHash
    .sha256[F](state).flatMap { stateHash =>
      rateLimiter.allow(stateHash).flatMap {
        case true => Async[F].pure(Right(()))
        case false => Async[F].delay(logger.warn("auth_callback_state_rate_limited")).as(Left(
            authProblem(
              AppError.TooManyRequests("Too many OAuth callback attempts. Start login again."),
              List(clearStateCookie(config)),
            )
          ))
      }
    }

  private def fetchUserWithBackoff[F[_]: Async](
      oauth: DiscordOAuthClient[F],
      providerBackoff: OAuthProviderBackoff[F],
      code: String,
  ): F[Either[AppError, momo.api.auth.DiscordUser]] =
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

  private def callbackProblem[F[_]: Async, A](
      config: AppConfig,
      reason: String,
      error: AppError,
  ): F[Either[AuthEndpoints.AuthProblemResponse, A]] = Async[F]
    .delay(logger.warn(s"auth_callback_rejected reason=$reason problemCode=${error.code}"))
    .as(Left(authProblem(error, List(clearStateCookie(config)))))

  private def authProblem(
      error: AppError,
      cookies: List[CookieWithMeta],
  ): AuthEndpoints.AuthProblemResponse =
    val (status, details) = ProblemDetails.from(error)
    (status, details, cookies)

  private def interactiveLoginPath(next: Option[String]): String = next match
    case None => AuthPaths.LoginPath
    case Some(path) => s"${AuthPaths.LoginPath}?next=${RedirectPath.encodeQueryValue(path)}"

  private def cookieValue(cookies: List[SttpCookie], name: String): Option[String] =
    cookies.find(_.name == name).map(_.value)

  private def sessionCookie(config: AppConfig, value: String): CookieWithMeta =
    baseCookie(config.auth.sessionCookieName, value, config)
      .maxAge(Some(config.auth.sessionTtl.toSeconds))

  private def stateCookie(config: AppConfig, value: String): CookieWithMeta =
    baseCookie(config.auth.stateCookieName, value, config)
      .maxAge(Some(config.auth.stateTtl.toSeconds))

  private def clearSessionCookie(config: AppConfig): CookieWithMeta =
    clearCookie(config.auth.sessionCookieName, config)

  private def clearStateCookie(config: AppConfig): CookieWithMeta =
    clearCookie(config.auth.stateCookieName, config)

  private def clearCookie(name: String, config: AppConfig): CookieWithMeta =
    baseCookie(name, "", config).maxAge(Some(0L))

  private def baseCookie(name: String, value: String, config: AppConfig): CookieWithMeta =
    CookieWithMeta(
      name = name,
      value = value,
      path = Some("/"),
      secure = config.auth.useSecureCookies,
      httpOnly = true,
      sameSite = Some(SttpCookie.SameSite.Lax),
    )
