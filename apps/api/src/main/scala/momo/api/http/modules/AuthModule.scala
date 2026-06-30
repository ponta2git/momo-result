package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.model.headers.{Cookie as SttpCookie, CookieWithMeta}
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.{
  AuthenticatedSession,
  CompleteOAuthCallback,
  CompleteOAuthLogin,
  CsrfTokenService,
  DiscordOAuthClient,
  OAuthCallbackDecision,
  OAuthCallbackInput,
  OAuthProviderBackoff,
  OAuthStateCodec,
  RateLimiter,
  SessionService
}
import momo.api.config.{AppConfig, AppEnv, RedirectPath}
import momo.api.domain.ids.AccountId
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
  ): List[ServerEndpoint[Any, F]] =
    val completeOAuthLogin = CompleteOAuthLogin[F](oauth, sessions, accounts, providerBackoff)
    val completeOAuthCallback = CompleteOAuthCallback[F](
      stateCodec,
      completeOAuthLogin,
      callbackStateRateLimiter,
      config.auth.callbackRedirectPath,
    )
    List(
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
          completeOAuthCallback = completeOAuthCallback,
          rateLimiter = rateLimiter,
        )
      },
      AuthEndpoints.logout
        .serverSecurityLogic { case (csrfToken, cookies) =>
          authenticateLogout(config, sessions, csrf, csrfToken, cookies)
        }
        .serverLogic(authenticated =>
          _ =>
            sessions.delete(authenticated.session.idHash)
              .as(Right(List(clearSessionCookie(config))))
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
      completeOAuthCallback: CompleteOAuthCallback[F],
      rateLimiter: RateLimiter[F],
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthEndpoints.RedirectOutput]] =
    rateLimit(rateLimiter, clientKey).flatMap {
      case Left(problem) => Async[F].pure(Left(problem))
      case Right(_) =>
        completeOAuthCallback
          .run(OAuthCallbackInput(
            code = code,
            state = state,
            cookieState = cookieValue(cookies, config.auth.stateCookieName),
            providerError = oauthError,
          ))
          .flatMap(renderCallbackDecision(config, _))
    }

  private def renderCallbackDecision[F[_]: Async](
      config: AppConfig,
      decision: OAuthCallbackDecision,
  ): F[Either[AuthEndpoints.AuthProblemResponse, AuthEndpoints.RedirectOutput]] = decision match
    case OAuthCallbackDecision.Completed(redirectPath, session) =>
      Async[F].pure(Right((
        redirectPath,
        List(
          sessionCookie(config, session.cookieValue),
          clearStateCookie(config),
        ),
      )))
    case OAuthCallbackDecision.ProviderDeniedSilent(next) =>
      Async[F].pure(Right((interactiveLoginPath(next), List(clearStateCookie(config)))))
    case OAuthCallbackDecision.Rejected(reason, error) =>
      callbackProblem(config, reason, error)

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
