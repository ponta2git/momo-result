package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.endpoints.codec.BoundaryId
import momo.api.endpoints.{
  AdminAccountEndpoints, CreateLoginAccountRequest, LoginAccountListResponse, LoginAccountResponse,
  UpdateLoginAccountRequest,
}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.usecases.{
  CreateLoginAccount, CreateLoginAccountCommand, ListLoginAccounts, UpdateLoginAccount,
  UpdateLoginAccountCommand,
}

object AdminAccountModule:
  def routes[F[_]: Async](
      listLoginAccounts: ListLoginAccounts[F],
      createLoginAccount: CreateLoginAccount[F],
      updateLoginAccount: UpdateLoginAccount[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    AdminAccountEndpoints.list.serverLogic { accountHeader =>
      security.authorizeAdminRead(accountHeader) { _ =>
        listLoginAccounts.run
          .map(items => Right(LoginAccountListResponse(items.map(LoginAccountResponse.from))))
      }
    },
    AdminAccountEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeAdminMutation(accountHeader, csrfToken) { account =>
        IdempotencyReplay.wrap[F, CreateLoginAccountRequest, LoginAccountResponse](
          idempotency,
          idemKey,
          account,
          "POST /api/admin/login-accounts",
          request,
          nowF,
          security.decode(
            toCommand(request)
          )(command => security.respond(createLoginAccount.run(command))(LoginAccountResponse.from)),
        )
      }
    },
    AdminAccountEndpoints.update.serverLogic {
      case (accountId, accountHeader, csrfToken, idemKey, request) => security
          .authorizeAdminMutation(accountHeader, csrfToken) { account =>
            IdempotencyReplay.wrap[F, (String, UpdateLoginAccountRequest), LoginAccountResponse](
              idempotency,
              idemKey,
              account,
              "PATCH /api/admin/login-accounts",
              (accountId, request),
              nowF,
              security.decode(BoundaryId.required("accountId", accountId)(AccountId.fromString)) {
                id =>
                  security.decode(toCommand(request))(command =>
                    security.respond(updateLoginAccount.run(id, command))(LoginAccountResponse.from)
                  )
              },
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
      isAdmin = request.isAdmin,
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
        isAdmin = request.isAdmin,
      )
    )
