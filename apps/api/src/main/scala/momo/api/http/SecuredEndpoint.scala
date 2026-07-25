package momo.api.http

import cats.effect.Async
import sttp.tapir.*
import sttp.tapir.model.ServerRequest
import sttp.tapir.server.{PartialServerEndpoint, ServerEndpoint}

import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.CommonEndpoint
import momo.api.endpoints.ProblemDetails.ProblemResponse
import momo.api.errors.AppError

object SecuredEndpoint:
  type ReadSecurityInput = (Option[String], ServerRequest)
  type MutationSecurityInput = (Option[String], Option[String], ServerRequest)

  type Read[F[_], I, O] =
    PartialServerEndpoint[ReadSecurityInput, AuthenticatedAccount, I, ProblemResponse, O, Any, F]

  type Mutation[F[_], I, O] = PartialServerEndpoint[
    MutationSecurityInput,
    AuthenticatedAccount,
    I,
    ProblemResponse,
    O,
    Any,
    F,
  ]

  type ReadEndpoint[I, O] = Endpoint[Option[String], I, ProblemResponse, O, Any]
  type MutationEndpoint[I, O] =
    Endpoint[(Option[String], Option[String]), I, ProblemResponse, O, Any]

  def readLogic[F[_]: Async, I, O, R](
      security: EndpointSecurity[F],
      endpoint: Endpoint[Option[String], I, ProblemResponse, O, R],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[R, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic(accountHeader =>
      security.authorizeRead(accountHeader._1, accountHeader._2)(account =>
        Async[F].pure(Right(account))
      )
    )
    .serverLogic(logic)

  def mutationLogic[F[_]: Async, I, O](
      security: EndpointSecurity[F],
      endpoint: MutationEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic { case (accountHeader, csrfToken, request) =>
      security.authorizeMutation(accountHeader, csrfToken, request)(account =>
        Async[F].pure(Right(account))
      )
    }
    .serverLogic(logic)

  def adminReadLogic[F[_]: Async, I, O](
      security: EndpointSecurity[F],
      endpoint: ReadEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic(accountHeader =>
      security.authorizeAdminRead(accountHeader._1, accountHeader._2)(account =>
        Async[F].pure(Right(account))
      )
    )
    .serverLogic(logic)

  def adminMutationLogic[F[_]: Async, I, O](
      security: EndpointSecurity[F],
      endpoint: MutationEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic { case (accountHeader, csrfToken, request) =>
      security.authorizeAdminMutation(accountHeader, csrfToken, request)(account =>
        Async[F].pure(Right(account))
      )
    }
    .serverLogic(logic)

  def masterMutationLogic[F[_]: Async, I, O](
      security: EndpointSecurity[F],
      endpoint: MutationEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic { case (accountHeader, csrfToken, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken, request)(account =>
        Async[F].pure(Right(account))
      )
    }
    .serverLogic(logic)

  def read[F[_]: Async](security: EndpointSecurity[F]): Read[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.serverRequest))
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic { case (accountHeader, request) =>
      security.authorizeRead(accountHeader, request)(account => Async[F].pure(Right(account)))
    }

  def mutation[F[_]: Async](security: EndpointSecurity[F]): Mutation[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader)
      .and(CommonEndpoint.serverRequest))
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic { case (accountHeader, csrfToken, request) =>
      security.authorizeMutation(accountHeader, csrfToken, request)(account =>
        Async[F].pure(Right(account))
      )
    }

  extension [F[_]](security: EndpointSecurity[F])
    def run[A](result: F[Either[AppError, A]]): F[Either[ProblemResponse, A]] =
      security.respond(result)(identity)
