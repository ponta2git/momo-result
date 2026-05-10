package momo.api.http

import momo.api.MomoCatsEffectSuite
import momo.api.auth.AuthenticatedAccount
import momo.api.domain.ids.AccountId
import momo.api.errors.AppError

final class MasterManagementPolicySpec extends MomoCatsEffectSuite:
  private val policy = new MasterManagementPolicy

  test("allows administrator accounts to manage masters") {
    val account = AuthenticatedAccount(
      accountId = AccountId("account_admin"),
      displayName = "admin",
      isAdmin = true,
      playerMemberId = None,
    )
    assertEquals(policy.requireManage(account), Right(()))
  }

  test("rejects non-administrator accounts") {
    val account = AuthenticatedAccount(
      accountId = AccountId("account_operator"),
      displayName = "operator",
      isAdmin = false,
      playerMemberId = None,
    )
    assertEquals(
      policy.requireManage(account),
      Left(AppError.Forbidden("Administrator access is required.")),
    )
  }
