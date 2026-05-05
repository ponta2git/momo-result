package momo.api.http

import cats.effect.Async
import cats.syntax.all.*

import momo.api.auth.{AuthenticatedMember, MemberRoster}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.domain.ids.MemberId
import momo.api.errors.AppError

/** Pluggable authentication / CSRF policy bound to the runtime environment.
  *
  * The HTTP layer never inspects `AppEnv` directly; it only calls these methods. Production trusts
  * `X-Dev-User` injected by `ProductionSessionMiddleware` (CSRF already verified there); Dev/Test
  * authenticates against the local roster and validates CSRF inline.
  */
trait AuthPolicy[F[_]]:
  def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ErrorInfo, AuthenticatedMember]]

  def verifyCsrf(csrfToken: Option[String]): F[Either[ProblemDetails.ErrorInfo, Unit]]

object AuthPolicy:
  def apply[F[_]: Async](config: AppConfig, roster: MemberRoster): AuthPolicy[F] =
    config.appEnv match
      case AppEnv.Prod => new ProductionAuthPolicy[F]
      case AppEnv.Dev | AppEnv.Test => new DevAuthPolicy[F](config, roster)

private final class ProductionAuthPolicy[F[_]: Async] extends AuthPolicy[F]:
  private def toProblem(error: AppError): ProblemDetails.ErrorInfo = ProblemDetails.from(error)

  override def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ErrorInfo, AuthenticatedMember]] = devUser match
    case Some(value) =>
      Async[F].pure(Right(AuthenticatedMember(MemberId(value), value)))
    case None => Async[F].pure(Left(toProblem(AppError.Unauthorized())))

  override def verifyCsrf(
      csrfToken: Option[String]
  ): F[Either[ProblemDetails.ErrorInfo, Unit]] =
    Async[F].pure(Right(()))

private final class DevAuthPolicy[F[_]: Async](config: AppConfig, roster: MemberRoster)
    extends AuthPolicy[F]:
  private def toProblem(error: AppError): ProblemDetails.ErrorInfo = ProblemDetails.from(error)

  override def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ErrorInfo, AuthenticatedMember]] = devUser match
    case Some(value) =>
      DevAuthMiddleware.authenticate(config.appEnv, roster, value).map(_.leftMap(toProblem))
    case None => Async[F].pure(Left(toProblem(AppError.Unauthorized())))

  override def verifyCsrf(
      csrfToken: Option[String]
  ): F[Either[ProblemDetails.ErrorInfo, Unit]] =
    CsrfMiddleware.validate(config.appEnv, csrfToken).map(_.leftMap(toProblem))
