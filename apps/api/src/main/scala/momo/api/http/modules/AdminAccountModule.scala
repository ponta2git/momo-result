package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.AccountId
import momo.api.endpoints.{
  AdminAccountEndpoints, CreateLoginAccountRequest, LoginAccountListResponse, LoginAccountResponse,
  UpdateLoginAccountRequest,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{
  CreateLoginAccount, CreateLoginAccountCommand, ListLoginAccounts, UpdateLoginAccount,
  UpdateLoginAccountCommand,
}

object AdminAccountModule:
  def routes[F[_]: Async](
      listLoginAccounts: ListLoginAccounts[F],
      createLoginAccount: CreateLoginAccount[F],
      updateLoginAccount: UpdateLoginAccount[F],
      idempotency: IdempotencyRepository[F],
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
          security.respond(createLoginAccount.run(toCommand(request)))(LoginAccountResponse.from),
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
              security.respond(
                updateLoginAccount.run(AccountId.unsafeFromString(accountId), toCommand(request))
              )(LoginAccountResponse.from),
            )
          }
    },
  )

  private def toCommand(request: CreateLoginAccountRequest): CreateLoginAccountCommand =
    CreateLoginAccountCommand(
      discordUserId = request.discordUserId,
      displayName = request.displayName,
      playerMemberId = request.playerMemberId,
      loginEnabled = request.loginEnabled,
      isAdmin = request.isAdmin,
    )

  private def toCommand(request: UpdateLoginAccountRequest): UpdateLoginAccountCommand =
    UpdateLoginAccountCommand(
      displayName = request.displayName,
      playerMemberId = request.playerMemberId,
      loginEnabled = request.loginEnabled,
      isAdmin = request.isAdmin,
    )
