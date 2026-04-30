package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import momo.api.auth.{AuthenticatedMember, MemberRoster}
import momo.api.config.AppConfig
import momo.api.errors.AppError

private[http] final class EndpointSecurity[F[_]: Async](config: AppConfig, roster: MemberRoster):
  private def toProblem(error: AppError): ProblemDetails.ErrorInfo = ProblemDetails.from(error)

  def authorizeRead[A](devUser: Option[String])(
      authorized: AuthenticatedMember => F[Either[ProblemDetails.ErrorInfo, A]]
  ): F[Either[ProblemDetails.ErrorInfo, A]] = authenticate(devUser).flatMap {
    case Left(error) => Async[F].pure(Left(error))
    case Right(member) => authorized(member)
  }

  def authorizeMutation[A](devUser: Option[String], csrfToken: Option[String])(
      authorized: AuthenticatedMember => F[Either[ProblemDetails.ErrorInfo, A]]
  ): F[Either[ProblemDetails.ErrorInfo, A]] = authorizeRead(devUser) { member =>
    CsrfMiddleware.validate(config.appEnv, csrfToken).map(_.leftMap(toProblem)).flatMap {
      case Left(error) => Async[F].pure(Left(error))
      case Right(_) => authorized(member)
    }
  }

  private def authenticate(
      devUser: Option[String]
  ): F[Either[ProblemDetails.ErrorInfo, AuthenticatedMember]] = devUser match
    case Some(value) => DevAuthMiddleware.authenticate(config.appEnv, roster, value)
        .map(_.leftMap(toProblem))
    case None => Async[F].pure(Left(toProblem(AppError.Unauthorized())))
