package momo.api.http

import momo.api.auth.AuthenticatedAccount
import momo.api.errors.AppError

final class MasterManagementPolicy:
  def requireManage(account: AuthenticatedAccount): Either[AppError, Unit] =
    Either.cond(
      account.isAdmin,
      (),
      AppError.Forbidden("Administrator access is required."),
    )
