package momo.api.http

import cats.effect.Async
import cats.syntax.all.*

import momo.api.auth.AuthenticatedMember
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

private[http] final class EndpointSecurity[F[_]: Async](policy: AuthPolicy[F]):
  def authorizeRead[A](devUser: Option[String])(
      authorized: AuthenticatedMember => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = policy.authenticate(devUser).flatMap {
    case Left(error) => Async[F].pure(Left(error))
    case Right(member) => authorized(member)
  }

  def authorizeMutation[A](devUser: Option[String], csrfToken: Option[String])(
      authorized: AuthenticatedMember => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = authorizeRead(devUser) { member =>
    policy.verifyCsrf(csrfToken).flatMap {
      case Left(error) => Async[F].pure(Left(error))
      case Right(_) => authorized(member)
    }
  }

  def toProblem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails.from(error)

  def respond[A, B](result: F[Either[AppError, A]])(
      onSuccess: A => B
  ): F[Either[ProblemDetails.ProblemResponse, B]] = result.map(_.leftMap(toProblem).map(onSuccess))
