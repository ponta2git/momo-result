package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.generic.semiauto.deriveCodec
import io.circe.{Codec, Decoder, DecodingFailure, Encoder, HCursor}
import sttp.tapir.Schema

import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.endpoints.AccountRoleApi.given

final case class LoginAccountResponse(
    accountId: String,
    discordUserId: String,
    displayName: String,
    playerMemberId: Option[String],
    loginEnabled: Boolean,
    role: AccountRole,
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object LoginAccountResponse:
  given Schema[LoginAccountResponse] = Schema.derived

  def from(account: LoginAccount): LoginAccountResponse = LoginAccountResponse(
    accountId = account.id.value,
    discordUserId = account.discordUserId.value,
    displayName = account.displayName,
    playerMemberId = account.playerMemberId.map(_.value),
    loginEnabled = account.loginEnabled,
    role = account.role,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(account.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(account.updatedAt),
  )

final case class LoginAccountListResponse(items: List[LoginAccountResponse]) derives Codec.AsObject

final case class CreateLoginAccountRequest(
    discordUserId: String,
    displayName: String,
    playerMemberId: Option[String],
    loginEnabled: Boolean,
    role: AccountRole,
)

object CreateLoginAccountRequest:
  given Schema[CreateLoginAccountRequest] = Schema.derived

  private val derivedCodec: Codec.AsObject[CreateLoginAccountRequest] = deriveCodec
  given Codec.AsObject[CreateLoginAccountRequest] = Codec.AsObject.from(
    Decoder.instance(cursor =>
      LoginAccountRequestCodec.rejectUnknownFields(
        cursor,
        Set("discordUserId", "displayName", "playerMemberId", "loginEnabled", "role"),
      ).flatMap(_ => derivedCodec(cursor))
    ),
    derivedCodec,
  )

final case class UpdateLoginAccountRequest(
    displayName: Option[String] = None,
    playerMemberId: Option[Option[String]] = None,
    loginEnabled: Option[Boolean] = None,
    role: Option[AccountRole] = None,
)

object UpdateLoginAccountRequest:
  given Schema[UpdateLoginAccountRequest] = Schema.derived

  private val derivedCodec: Codec.AsObject[UpdateLoginAccountRequest] = deriveCodec
  given Codec.AsObject[UpdateLoginAccountRequest] = Codec.AsObject.from(
    Decoder.instance(cursor =>
      for
        _ <- LoginAccountRequestCodec.rejectUnknownFields(
          cursor,
          Set("displayName", "playerMemberId", "loginEnabled", "role"),
        )
        _ <-
          if cursor.downField("role").succeeded then cursor.get[AccountRole]("role").map(_ => ())
          else Right(())
        request <- derivedCodec(cursor)
      yield request
    ),
    Encoder.AsObject.instance(request =>
      val encoded = derivedCodec.encodeObject(request)
      if request.role.isEmpty then encoded.remove("role") else encoded
    ),
  )

private object LoginAccountRequestCodec:
  def rejectUnknownFields(cursor: HCursor, allowed: Set[String]): Decoder.Result[Unit] =
    val unknown = cursor.keys.toList.flatten.filterNot(allowed).toList.sorted
    Either.cond(
      unknown.isEmpty,
      (),
      DecodingFailure(s"Unknown fields: ${unknown.mkString(", ")}", cursor.history),
    )
