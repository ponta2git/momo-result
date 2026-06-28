package momo.api.http

import cats.effect.Async
import sttp.tapir.*
import sttp.tapir.server.{PartialServerEndpoint, ServerEndpoint}

import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.CommonEndpoint
import momo.api.endpoints.ProblemDetails.ProblemResponse
import momo.api.errors.AppError

object SecuredEndpoint:
  type Read[F[_], I, O] =
    PartialServerEndpoint[Option[String], AuthenticatedAccount, I, ProblemResponse, O, Any, F]

  type Mutation[F[_], I, O] = PartialServerEndpoint[
    (Option[String], Option[String]),
    AuthenticatedAccount,
    I,
    ProblemResponse,
    O,
    Any,
    F,
  ]

  type ReadEndpoint[I, O] = Endpoint[Option[String], I, ProblemResponse, O, Any]

  def readLogic[F[_]: Async, I, O](
      security: EndpointSecurity[F],
      endpoint: ReadEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .serverSecurityLogic(accountHeader =>
      security.authorizeRead(accountHeader)(account => Async[F].pure(Right(account)))
    )
    .serverLogic(logic)

  def read[F[_]: Async](security: EndpointSecurity[F]): Read[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic(accountHeader =>
      security.authorizeRead(accountHeader)(account => Async[F].pure(Right(account)))
    )

  def mutation[F[_]: Async](security: EndpointSecurity[F]): Mutation[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic { case (accountHeader, csrfToken) =>
      security.authorizeMutation(accountHeader, csrfToken)(account => Async[F].pure(Right(account)))
    }

  def adminRead[F[_]: Async](security: EndpointSecurity[F]): Read[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic(accountHeader =>
      security.authorizeAdminRead(accountHeader)(account => Async[F].pure(Right(account)))
    )

  def adminMutation[F[_]: Async](security: EndpointSecurity[F]): Mutation[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic { case (accountHeader, csrfToken) =>
      security.authorizeAdminMutation(accountHeader, csrfToken)(account =>
        Async[F].pure(Right(account))
      )
    }

  def masterMutation[F[_]: Async](security: EndpointSecurity[F]): Mutation[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic { case (accountHeader, csrfToken) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken)(account =>
        Async[F].pure(Right(account))
      )
    }

  extension [F[_]](security: EndpointSecurity[F])
    def run[A](result: F[Either[AppError, A]]): F[Either[ProblemResponse, A]] =
      security.respond(result)(identity)
