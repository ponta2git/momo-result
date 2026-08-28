package momo.api.http

import sttp.tapir.*
import sttp.tapir.model.ServerRequest
import sttp.tapir.server.{PartialServerEndpoint, ServerEndpoint}

import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.CommonEndpoint
import momo.api.endpoints.ProblemDetails.ProblemResponse

object SecuredEndpoint:
  type ReadSecurityInput = (Option[String], ServerRequest)
  type Read[F[_], I, O] =
    PartialServerEndpoint[ReadSecurityInput, AuthenticatedAccount, I, ProblemResponse, O, Any, F]

  type ReadEndpoint[I, O] = Endpoint[Option[String], I, ProblemResponse, O, Any]
  type MutationEndpoint[I, O] =
    Endpoint[(Option[String], Option[String]), I, ProblemResponse, O, Any]

  def readLogic[F[_], I, O, R](
      security: EndpointSecurity[F],
      endpoint: Endpoint[Option[String], I, ProblemResponse, O, R],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[R, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic(accountHeader =>
      security.authorizeRead(accountHeader._1, accountHeader._2)
    )
    .serverLogic(logic)

  def mutationLogic[F[_], I, O](
      security: EndpointSecurity[F],
      endpoint: MutationEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic { case (accountHeader, csrfToken, request) =>
      security.authorizeMutation(accountHeader, csrfToken, request)
    }
    .serverLogic(logic)

  def adminReadLogic[F[_], I, O](
      security: EndpointSecurity[F],
      endpoint: ReadEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic(accountHeader =>
      security.authorizeAdminRead(accountHeader._1, accountHeader._2)
    )
    .serverLogic(logic)

  def adminMutationLogic[F[_], I, O](
      security: EndpointSecurity[F],
      endpoint: MutationEndpoint[I, O],
  )(
      logic: AuthenticatedAccount => I => F[Either[ProblemResponse, O]]
  ): ServerEndpoint[Any, F] = endpoint
    .securityIn(CommonEndpoint.serverRequest)
    .serverSecurityLogic { case (accountHeader, csrfToken, request) =>
      security.authorizeAdminMutation(accountHeader, csrfToken, request)
    }
    .serverLogic(logic)

  def read[F[_]](security: EndpointSecurity[F]): Read[F, Unit, Unit] = endpoint
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.serverRequest))
    .errorOut(CommonEndpoint.errorOut)
    .serverSecurityLogic { case (accountHeader, request) =>
      security.authorizeRead(accountHeader, request)
    }
