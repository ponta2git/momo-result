package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.endpoints.codec.BoundaryId
import momo.api.endpoints.{
  AdminAccountEndpoints,
  CreateLoginAccountRequest,
  LoginAccountListResponse,
  LoginAccountResponse,
  UpdateLoginAccountRequest
}
import momo.api.errors.AppError
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.admin.{
  CreateLoginAccount,
  CreateLoginAccountCommand,
  ListLoginAccounts,
  UpdateLoginAccount,
  UpdateLoginAccountCommand
}

object AdminAccountModule:
  final case class UseCases[F[_]](
      listLoginAccounts: ListLoginAccounts[F],
      createLoginAccount: CreateLoginAccount[F],
      updateLoginAccount: UpdateLoginAccount[F],
  )

  def routes[F[_]: Async](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.adminReadLogic(security, AdminAccountEndpoints.list) { _ => _ =>
        listLoginAccounts.run
          .map(items => Right(LoginAccountListResponse(items.map(LoginAccountResponse.from))))
      },
      SecuredEndpoint.adminMutationLogic(security, AdminAccountEndpoints.create) { account =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.CreateLoginAccount,
              idemKey,
              account,
              request,
            )(
              toCommand(request)
            )(command =>
              createLoginAccount.run(command)
            )(
              LoginAccountResponse.from
            )
        }
      },
      SecuredEndpoint.adminMutationLogic(security, AdminAccountEndpoints.update) { account =>
        {
          case (accountId, idemKey, request) =>
            execution.mutation(
              HttpOperation.UpdateLoginAccount,
              idemKey,
              account,
              (accountId, request),
            )(
              for
                id <- BoundaryId.required("accountId", accountId)(AccountId.fromString)
                command <- toCommand(request)
              yield (id, command)
            ) { case (id, command) =>
              updateLoginAccount.run(id, command)
            }(
              LoginAccountResponse.from
            )
        }
      },
    )

  private def toCommand(
      request: CreateLoginAccountRequest
  ): Either[AppError, CreateLoginAccountCommand] =
    for
      discordUserId <- BoundaryId
        .required("discordUserId", request.discordUserId)(UserId.fromString)
      playerMemberId <- BoundaryId
        .optional("playerMemberId", request.playerMemberId)(MemberId.fromString)
    yield CreateLoginAccountCommand(
      discordUserId = discordUserId,
      displayName = request.displayName,
      playerMemberId = playerMemberId,
      loginEnabled = request.loginEnabled,
      role = request.role,
    )

  private def toCommand(
      request: UpdateLoginAccountRequest
  ): Either[AppError, UpdateLoginAccountCommand] = request.playerMemberId
    .traverse(_.traverse(id => BoundaryId.required("playerMemberId", id)(MemberId.fromString)))
    .map(playerMemberId =>
      UpdateLoginAccountCommand(
        displayName = request.displayName,
        playerMemberId = playerMemberId,
        loginEnabled = request.loginEnabled,
        role = request.role,
      )
    )
