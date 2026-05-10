package momo.api.http

import cats.effect.Async
import cats.syntax.all.*

import momo.api.auth.{AuthenticatedAccount, MemberRoster}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.domain.ids.AccountId
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError
import momo.api.repositories.LoginAccountsRepository

/**
 * Pluggable authentication / CSRF policy bound to the runtime environment.
 *
 * The HTTP layer never inspects `AppEnv` directly; it only calls these methods. Production trusts
 * `X-Dev-User` injected by `ProductionSessionMiddleware` (CSRF already verified there); Dev/Test
 * authenticates against the local roster and validates CSRF inline.
 */
trait AuthPolicy[F[_]]:
  def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]]

  def verifyCsrf(csrfToken: Option[String]): F[Either[ProblemDetails.ProblemResponse, Unit]]

object AuthPolicy:
  def apply[F[_]: Async](
      config: AppConfig,
      roster: MemberRoster,
      accounts: LoginAccountsRepository[F],
  ): AuthPolicy[F] = config.appEnv match
    case AppEnv.Prod => new ProductionAuthPolicy[F](accounts)
    case AppEnv.Dev | AppEnv.Test => new DevAuthPolicy[F](config, roster, accounts)

private final class ProductionAuthPolicy[F[_]: Async](accounts: LoginAccountsRepository[F])
    extends AuthPolicy[F]:
  private def toProblem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails
    .from(error)

  override def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = devUser match
    case Some(value) => accounts.find(AccountId(value)).map {
        case Some(account) if account.loginEnabled =>
          Right(AuthenticatedAccount(
            account.id,
            account.displayName,
            account.isAdmin,
            account.playerMemberId,
          ))
        case Some(_) =>
          Left(toProblem(AppError.Forbidden("This account is not allowed to log in.")))
        case None => Left(toProblem(AppError.Unauthorized()))
      }
    case None => Async[F].pure(Left(toProblem(AppError.Unauthorized())))

  override def verifyCsrf(
      csrfToken: Option[String]
  ): F[Either[ProblemDetails.ProblemResponse, Unit]] = Async[F].pure(Right(()))

private final class DevAuthPolicy[F[_]: Async](
    config: AppConfig,
    roster: MemberRoster,
    accounts: LoginAccountsRepository[F],
) extends AuthPolicy[F]:
  private def toProblem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails
    .from(error)

  override def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = devUser match
    case Some(value) => DevAuthMiddleware.authenticate(config.appEnv, roster, value).flatMap {
        case Right(account) => Async[F].pure(Right(account))
        case Left(_) => accounts.find(AccountId(value)).map {
            case Some(account) if account.loginEnabled =>
              Right(AuthenticatedAccount(
                account.id,
                account.displayName,
                account.isAdmin,
                account.playerMemberId,
              ))
            case Some(_) =>
              Left(toProblem(AppError.Forbidden("This account is not allowed to log in.")))
            case None =>
              Left(toProblem(AppError.Forbidden("X-Dev-User is not one of the allowed accounts.")))
          }
      }
    case None => Async[F].pure(Left(toProblem(AppError.Unauthorized())))

  override def verifyCsrf(
      csrfToken: Option[String]
  ): F[Either[ProblemDetails.ProblemResponse, Unit]] = CsrfMiddleware
    .validate(config.appEnv, csrfToken).map(_.leftMap(toProblem))
