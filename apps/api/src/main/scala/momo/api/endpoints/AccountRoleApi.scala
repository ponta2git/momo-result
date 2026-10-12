package momo.api.endpoints

import io.circe.{Codec, Decoder, Encoder}
import sttp.tapir.{Schema, Validator}

import momo.api.domain.AccountRole

object AccountRoleApi:
  given Codec[AccountRole] = Codec.from(
    Decoder.decodeString.emap(AccountRole.fromWire),
    Encoder.encodeString.contramap(_.wire),
  )

  given Schema[AccountRole] = Schema.string[AccountRole]
    .validate(Validator.enumeration(AccountRole.values.toList, role => Some(role.wire)))
