package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.tapir.model.ServerRequest

import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

private[http] final class EndpointSecurity[F[_]: Async](
    policy: AuthPolicy[F],
    incidentLogger: AppError => F[Unit],
):
  def authorizeRead(
      accountHeader: Option[String],
      request: ServerRequest,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] =
    policy.authenticate(AuthRequestContext(accountHeader, None, request))

  def authorizeMutation(
      accountHeader: Option[String],
      csrfToken: Option[String],
      request: ServerRequest,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] =
    policy.authenticate(AuthRequestContext(accountHeader, csrfToken, request))

  def authorizeAdminMutation(
      accountHeader: Option[String],
      csrfToken: Option[String],
      request: ServerRequest,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = requireAdmin(
    authorizeMutation(accountHeader, csrfToken, request)
  )

  def authorizeAdminRead(
      accountHeader: Option[String],
      request: ServerRequest,
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = requireAdmin(
    authorizeRead(accountHeader, request)
  )

  private def requireAdmin(
      authenticated: F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]]
  ): F[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = authenticated.map(
    _.flatMap(account =>
      Either.cond(
        account.isAdmin,
        account,
        problem(AppError.Forbidden("Administrator access is required.")),
      )
    )
  )

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
    if HttpIncidentPolicy.shouldLog(error) then incidentLogger(error) else Async[F].unit

  private def problem(error: AppError): ProblemDetails.ProblemResponse = ProblemDetails.from(error)

object EndpointSecurity:
  private val logger = LoggerFactory.getLogger("momo.api.http.EndpointSecurity")

  def apply[F[_]: Async](policy: AuthPolicy[F]): EndpointSecurity[F] =
    new EndpointSecurity(policy, defaultIncidentLogger[F])

  def apply[F[_]: Async](
      policy: AuthPolicy[F],
      incidentLogger: AppError => F[Unit],
  ): EndpointSecurity[F] = new EndpointSecurity(policy, incidentLogger)

  private def defaultIncidentLogger[F[_]: Async](error: AppError): F[Unit] = Async[F]
    .delay(logger.error(s"HTTP endpoint returned incident problemCode=${error.code}"))
