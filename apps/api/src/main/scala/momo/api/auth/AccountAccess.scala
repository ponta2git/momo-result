package momo.api.auth

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.AccountId
import momo.api.errors.AppError
import momo.api.repositories.LoginAccountsRepository

/** Resolves enabled login accounts without exposing their persistence records to HTTP. */
final class AccountAccess[F[_]: Monad](accounts: LoginAccountsRepository[F]):
  def find(rawId: String): F[Either[AppError, AuthenticatedAccount]] =
    AccountId.fromString(rawId) match
      case Left(_) => unknownAccount.pure[F]
      case Right(id) => accounts.find(id).map {
          case Some(account) if account.loginEnabled => Right(AuthenticatedAccount.from(account))
          case Some(_) => Left(AppError.Forbidden("This account is not allowed to log in."))
          case None => unknownAccount
        }

  private def unknownAccount: Either[AppError, AuthenticatedAccount] =
    Left(AppError.Forbidden("Account header is not one of the allowed accounts."))
