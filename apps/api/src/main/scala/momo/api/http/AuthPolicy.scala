package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import sttp.model.headers.Cookie
import sttp.tapir.model.ServerRequest

import momo.api.auth.{AuthenticatedAccount, CsrfTokenService, MemberRoster, SessionService}
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
  private def toProblem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails
    .from(error)

  override def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = authenticateSession(context)
    .map(_.map(_.account))

  private def authenticateSession(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, momo.api.auth.AuthenticatedSession]] =
    sessions.authenticate(sessionCookie(config, context.request)).map {
      case Left(error) => Left(toProblem(error))
      case Right(authenticated) => verifyMutationCsrf(authenticated, context)
          .map(_ => authenticated).leftMap(toProblem)
    }

  private def verifyMutationCsrf(
      authenticated: momo.api.auth.AuthenticatedSession,
      context: AuthRequestContext,
  ): Either[AppError, Unit] =
    if isMutating(context.request) then
      csrf.verify(authenticated.session, context.csrfToken)
    else Right(())

private final class DevAuthPolicy[F[_]: Async](
    config: AppConfig,
    roster: MemberRoster,
    accounts: LoginAccountsRepository[F],
    sessions: SessionService[F],
    csrf: CsrfTokenService,
) extends AuthPolicy[F]:
  private def toProblem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails
    .from(error)

  override def authenticate(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = context.accountHeader match
    case Some(value) => DevAuthMiddleware.authenticate(config.appEnv, roster, value).flatMap {
        case Right(account) => authorizeAccount(account, context)
        case Left(_) => AccountId.fromString(value) match
            case Left(_) => Async[F].pure(Left(
                toProblem(AppError.Forbidden("Account header is not one of the allowed accounts."))
              ))
            case Right(accountId) => accounts.find(accountId).flatMap {
                case Some(account) if account.loginEnabled =>
                  authorizeAccount(
                    AuthenticatedAccount(
                      account.id,
                      account.displayName,
                      account.isAdmin,
                      account.playerMemberId,
                    ),
                    context
                  )
                case Some(_) =>
                  Async[F].pure(Left(toProblem(AppError
                    .Forbidden("This account is not allowed to log in."))))
                case None => Left(toProblem(
                    AppError.Forbidden("Account header is not one of the allowed accounts.")
                  )).pure[F]
              }
      }
    case None => authenticateSession(context).map(_.map(_.account))

  private def authorizeAccount(
      account: AuthenticatedAccount,
      context: AuthRequestContext,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = verifyDevCsrf(context)
    .map(_.map(_ => account))

  private def verifyDevCsrf(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, Unit]] =
    if isMutating(context.request) then
      CsrfMiddleware.validate(config.appEnv, context.csrfToken).map(_.leftMap(toProblem))
    else Async[F].pure(Right(()))

  private def authenticateSession(
      context: AuthRequestContext
  ): F[Either[ProblemDetails.ProblemResponse, momo.api.auth.AuthenticatedSession]] =
    sessions.authenticate(sessionCookie(config, context.request)).map {
      case Left(error) => Left(toProblem(error))
      case Right(authenticated) =>
        if isMutating(context.request) then
          csrf.verify(authenticated.session, context.csrfToken)
            .map(_ => authenticated).leftMap(toProblem)
        else Right(authenticated)
    }

private def sessionCookie(config: AppConfig, request: ServerRequest): Option[String] =
  request.header("Cookie")
    .flatMap(raw => Cookie.parse(raw).toOption)
    .flatMap(_.find(_.name == config.auth.sessionCookieName).map(_.value))

private def isMutating(request: ServerRequest): Boolean =
  Set("POST", "PUT", "PATCH", "DELETE").contains(request.method.method)
