package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory

import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

private[http] final class EndpointSecurity[F[_]: Async](
    policy: AuthPolicy[F],
    masterManagementPolicy: MasterManagementPolicy,
    incidentLogger: AppError => F[Unit],
):
  def authorizeRead[A](accountHeader: Option[String])(
      authorized: AuthenticatedAccount => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = policy.authenticate(accountHeader).flatMap {
    case Left(error) => Async[F].pure(Left(error))
    case Right(member) => authorized(member)
  }

  def authorizeMutation[A](accountHeader: Option[String], csrfToken: Option[String])(
      authorized: AuthenticatedAccount => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = authorizeRead(accountHeader) { member =>
    policy.verifyCsrf(csrfToken).flatMap {
      case Left(error) => Async[F].pure(Left(error))
      case Right(_) => authorized(member)
    }
  }

  def authorizeAdminMutation[A](accountHeader: Option[String], csrfToken: Option[String])(
      authorized: AuthenticatedAccount => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = authorizeMutation(accountHeader, csrfToken) {
    account =>
      if account.isAdmin then authorized(account)
      else Async[F].pure(Left(toProblem(AppError.Forbidden("Administrator access is required."))))
  }

  def authorizeAdminRead[A](accountHeader: Option[String])(
      authorized: AuthenticatedAccount => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = authorizeRead(accountHeader) { account =>
    if account.isAdmin then authorized(account)
    else Async[F].pure(Left(toProblem(AppError.Forbidden("Administrator access is required."))))
  }

  def authorizeMasterManagementMutation[A](
      accountHeader: Option[String],
      csrfToken: Option[String],
  )(
      authorized: AuthenticatedAccount => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = authorizeMutation(accountHeader, csrfToken) {
    account =>
      masterManagementPolicy.requireManage(account) match
        case Right(_) => authorized(account)
        case Left(error) => Async[F].pure(Left(toProblem(error)))
  }

  def toProblem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails.from(error)

  def toProblemF(error: AppError): F[ProblemDetails.ProblemResponse] = logIncident(error)
    .as(ProblemDetails.from(error))

  def respond[A, B](
      result: F[Either[AppError, A]]
  )(onSuccess: A => B): F[Either[ProblemDetails.ProblemResponse, B]] = result.flatMap {
    case Left(error) => toProblemF(error).map(Left(_))
    case Right(value) => Async[F].pure(Right(onSuccess(value)))
  }

  def decode[A, B](decoded: Either[AppError, A])(
      onSuccess: A => F[Either[ProblemDetails.ProblemResponse, B]]
  ): F[Either[ProblemDetails.ProblemResponse, B]] = decoded match
    case Left(error) => toProblemF(error).map(Left(_))
    case Right(value) => onSuccess(value)

  private def logIncident(error: AppError): F[Unit] =
    if EndpointSecurity.isIncident(error) then incidentLogger(error) else Async[F].unit

object EndpointSecurity:
  private val logger = LoggerFactory.getLogger("momo.api.http.EndpointSecurity")

  def apply[F[_]: Async](policy: AuthPolicy[F]): EndpointSecurity[F] =
    new EndpointSecurity(policy, new MasterManagementPolicy, defaultIncidentLogger[F])

  def apply[F[_]: Async](
      policy: AuthPolicy[F],
      incidentLogger: AppError => F[Unit],
  ): EndpointSecurity[F] = new EndpointSecurity(policy, new MasterManagementPolicy, incidentLogger)

  private def defaultIncidentLogger[F[_]: Async](error: AppError): F[Unit] = Async[F]
    .delay(logger.error(s"HTTP endpoint returned incident problemCode=${error.code}"))

  private def isIncident(error: AppError): Boolean = error match
    case _: AppError.DependencyFailed => true
    case _: AppError.Internal => true
    case _ => false
