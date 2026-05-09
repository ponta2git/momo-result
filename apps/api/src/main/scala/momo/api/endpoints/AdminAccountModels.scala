package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.LoginAccount

final case class LoginAccountResponse(
    accountId: String,
    discordUserId: String,
    displayName: String,
    playerMemberId: Option[String],
    loginEnabled: Boolean,
    isAdmin: Boolean,
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object LoginAccountResponse:
  def from(account: LoginAccount): LoginAccountResponse = LoginAccountResponse(
    accountId = account.id.value,
    discordUserId = account.discordUserId.value,
    displayName = account.displayName,
    playerMemberId = account.playerMemberId.map(_.value),
    loginEnabled = account.loginEnabled,
    isAdmin = account.isAdmin,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(account.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(account.updatedAt),
  )

final case class LoginAccountListResponse(items: List[LoginAccountResponse]) derives Codec.AsObject

final case class CreateLoginAccountRequest(
    discordUserId: String,
    displayName: String,
    playerMemberId: Option[String],
    loginEnabled: Boolean,
    isAdmin: Boolean,
) derives Codec.AsObject

final case class UpdateLoginAccountRequest(
    displayName: Option[String] = None,
    playerMemberId: Option[Option[String]] = None,
    loginEnabled: Option[Boolean] = None,
    isAdmin: Option[Boolean] = None,
) derives Codec.AsObject
