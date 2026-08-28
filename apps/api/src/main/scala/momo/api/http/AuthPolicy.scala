package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import sttp.model.headers.Cookie
import sttp.tapir.model.ServerRequest

import momo.api.auth.{
  AuthenticatedAccount,
  AuthenticatedSession,
  CsrfTokenService,
  MemberRoster,
  SessionService
}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.domain.ids.AccountId
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError
import momo.api.repositories.LoginAccountsRepository

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
      accounts: LoginAccountsRepository[F],
      sessions: SessionService[F],
      csrf: CsrfTokenService,
  ): AuthPolicy[F] = config.appEnv match
    case AppEnv.Prod => new ProductionAuthPolicy[F](config, sessions, csrf)
    case AppEnv.Dev | AppEnv.Test => new DevAuthPolicy[F](config, roster, accounts, sessions, csrf)

private final class ProductionAuthPolicy[F[_]: Async](
    config: AppConfig,
    sessions: SessionService[F],
    csrf: CsrfTokenService,
) extends AuthPolicy[F]:
  override def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = authenticateSession(
    config,
    sessions,
    csrf,
    context,
  ).map(_.map(_.account))

private final class DevAuthPolicy[F[_]: Async](
    config: AppConfig,
    roster: MemberRoster,
    accounts: LoginAccountsRepository[F],
    sessions: SessionService[F],
    csrf: CsrfTokenService,
) extends AuthPolicy[F]:
  override def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = context.accountHeader match
    case Some(value) => roster.find(value) match
        case Some(account) => authorizeAccount(account, context)
        case None => AccountId.fromString(value) match
            case Left(_) => forbiddenUnknownAccount.pure[F]
            case Right(accountId) => accounts.find(accountId).flatMap {
                case Some(account) if account.loginEnabled =>
                  authorizeAccount(
                    AuthenticatedAccount(
                      account.id,
                      account.displayName,
                      account.isAdmin,
                      account.playerMemberId,
                    ),
                    context,
                  )
                case Some(_) => Left(problem(
                    AppError.Forbidden("This account is not allowed to log in.")
                  )).pure[F]
                case None => forbiddenUnknownAccount.pure[F]
              }
    case None => authenticateSession(config, sessions, csrf, context).map(_.map(_.account))

  private def authorizeAccount(
      account: AuthenticatedAccount,
      context: AuthRequestContext,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] =
    verifyDevelopmentCsrf(context).map(_ => account).leftMap(problem).pure[F]

  private def forbiddenUnknownAccount
      : Either[ProblemDetails.ProblemResponse, AuthenticatedAccount] = Left(problem(
    AppError.Forbidden("Account header is not one of the allowed accounts.")
  ))

private def authenticateSession[F[_]: Async](
    config: AppConfig,
    sessions: SessionService[F],
    csrf: CsrfTokenService,
    context: AuthRequestContext,
): F[Either[ProblemDetails.ProblemResponse, AuthenticatedSession]] =
  sessions.authenticate(sessionCookie(config, context.request)).map {
    case Left(error) => Left(problem(error))
    case Right(authenticated) => verifySessionCsrf(authenticated, csrf, context)
        .map(_ => authenticated).leftMap(problem)
  }

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
  request.header("Cookie")
    .flatMap(raw => Cookie.parse(raw).toOption)
    .flatMap(_.find(_.name == config.auth.sessionCookieName).map(_.value))

private def isMutating(request: ServerRequest): Boolean =
  HttpMethodPredicates.isMutating(request.method.method)
