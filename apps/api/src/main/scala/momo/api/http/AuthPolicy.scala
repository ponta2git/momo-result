package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.model.ServerRequest

import momo.api.auth.{
  AccountAccess,
  AuthenticatedAccount,
  AuthenticatedSession,
  CsrfTokenService,
  MemberRoster,
  RateLimiter,
  SessionService
}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

/**
 * Pluggable authentication / CSRF policy bound to the runtime environment.
 *
 * The HTTP layer never inspects `AppEnv` directly; it only calls these methods. Production ignores
 * externally supplied account headers and authenticates the session cookie. Dev/Test keeps the local
 * account-header shortcut and falls back to session cookies for session-backed integration tests.
 */
final case class AuthRequestContext(
    accountHeader: Option[String],
    csrfToken: Option[String],
    request: ServerRequest,
)

trait AuthPolicy[F[_]]:
  def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]]

object AuthPolicy:
  private[http] val DevelopmentCsrfToken = "dev"

  def apply[F[_]: Async](
      config: AppConfig,
      roster: MemberRoster,
      accounts: AccountAccess[F],
      sessions: SessionService[F],
      csrf: CsrfTokenService,
      readRateLimiter: RateLimiter[F],
      mutationAttemptRateLimiter: RateLimiter[F],
  ): AuthPolicy[F] = config.appEnv match
    case AppEnv.Prod => new ProductionAuthPolicy[F](
        config,
        sessions,
        csrf,
        readRateLimiter,
        mutationAttemptRateLimiter
      )
    case AppEnv.Dev | AppEnv.Test => new DevAuthPolicy[F](
        config,
        roster,
        accounts,
        sessions,
        csrf,
        readRateLimiter,
        mutationAttemptRateLimiter
      )

private final class ProductionAuthPolicy[F[_]: Async](
    config: AppConfig,
    sessions: SessionService[F],
    csrf: CsrfTokenService,
    readRateLimiter: RateLimiter[F],
    mutationAttemptRateLimiter: RateLimiter[F],
) extends AuthPolicy[F]:
  override def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = authenticateSession(
    config,
    sessions,
    csrf,
    context,
    attemptLimiter(context, readRateLimiter, mutationAttemptRateLimiter),
  ).map(_.map(_.account))

private final class DevAuthPolicy[F[_]: Async](
    config: AppConfig,
    roster: MemberRoster,
    accounts: AccountAccess[F],
    sessions: SessionService[F],
    csrf: CsrfTokenService,
    readRateLimiter: RateLimiter[F],
    mutationAttemptRateLimiter: RateLimiter[F],
) extends AuthPolicy[F]:
  override def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = context.accountHeader match
    case Some(value) => roster.find(value) match
        case Some(account) => authorizeAccount(account, context)
        case None => accounts.find(value).flatMap {
            case Left(error) => Left(problem(error)).pure[F]
            case Right(account) => authorizeAccount(account, context)
          }
    case None => authenticateSession(
        config,
        sessions,
        csrf,
        context,
        attemptLimiter(context, readRateLimiter, mutationAttemptRateLimiter)
      ).map(_.map(_.account))

  private def authorizeAccount(
      account: AuthenticatedAccount,
      context: AuthRequestContext,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] =
    HttpRateLimiters.checkAttempt(
      attemptLimiter(context, readRateLimiter, mutationAttemptRateLimiter),
      account.accountId.value
    ).map(_.flatMap(_ => verifyDevelopmentCsrf(context)).map(_ => account).leftMap(problem))

private def authenticateSession[F[_]: Async](
    config: AppConfig,
    sessions: SessionService[F],
    csrf: CsrfTokenService,
    context: AuthRequestContext,
    limiter: RateLimiter[F],
): F[Either[ProblemDetails.ProblemResponse, AuthenticatedSession]] =
  sessions.authenticate(sessionCookie(config, context.request)).flatMap {
    case Left(error) => Left(problem(error)).pure[F]
    case Right(authenticated) => HttpRateLimiters
        .checkAttempt(limiter, authenticated.account.accountId.value)
        .map(_.flatMap(_ => verifySessionCsrf(authenticated, csrf, context))
          .map(_ => authenticated).leftMap(problem))
  }

private def attemptLimiter[F[_]](
    context: AuthRequestContext,
    read: RateLimiter[F],
    mutation: RateLimiter[F],
): RateLimiter[F] = if isMutating(context.request) then mutation else read

private def verifySessionCsrf(
    authenticated: AuthenticatedSession,
    csrf: CsrfTokenService,
    context: AuthRequestContext,
): Either[AppError, Unit] =
  if isMutating(context.request) then csrf.verify(authenticated.session, context.csrfToken)
  else Right(())

private def verifyDevelopmentCsrf(context: AuthRequestContext): Either[AppError, Unit] =
  if !isMutating(context.request) || context.csrfToken.contains(AuthPolicy.DevelopmentCsrfToken)
  then
    Right(())
  else
    Left(AppError.Forbidden(
      "Development CSRF token is required. Use X-CSRF-Token: dev."
    ))

private def problem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails.from(error)

private def sessionCookie(config: AppConfig, request: ServerRequest): Option[String] =
  AuthCookies.value(request, config.auth.sessionCookieName)

private def isMutating(request: ServerRequest): Boolean =
  HttpMethodPredicates.isMutating(request.method.method)
