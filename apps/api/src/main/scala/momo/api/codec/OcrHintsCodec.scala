package momo.api.codec

import io.circe.syntax.*
import io.circe.{Codec, Decoder, DecodingFailure, Encoder, HCursor, Json, JsonObject}

import momo.api.domain.ids.MemberId
import momo.api.domain.{OcrJobHints, PlayerAliasHint}

/**
 * Wire-format codec for OCR hint payloads.
 *
 * Lives in a neutral boundary package so both the endpoints layer (Tapir/JSON request bodies)
 * and the repositories layer (Redis queue payload) can depend on it without forming a reverse
 * SDP arrow. The on-wire JSON shape (field names and order) must stay byte-identical to what
 * the OCR worker and the web client expect, so this object only exposes derived `Codec`s over
 * the case class declarations themselves.
 */
object OcrHintsCodec:
  given Encoder.AsObject[PlayerAliasHint] with
    override def encodeObject(hint: PlayerAliasHint): JsonObject = JsonObject(
      "memberId" -> Json.fromString(hint.memberId.value),
      "aliases" -> hint.aliases.asJson,
    )

  given Decoder[PlayerAliasHint] with
    override def apply(cursor: HCursor): Decoder.Result[PlayerAliasHint] =
      for
        memberId <- cursor.downField("memberId").as[String]
        parsedMemberId <- MemberId.fromString(memberId).left
          .map(_ => DecodingFailure("memberId must not be blank", cursor.history))
        aliases <- cursor.downField("aliases").as[List[String]]
      yield PlayerAliasHint(parsedMemberId, aliases)

  given Codec.AsObject[OcrJobHints] = Codec.AsObject.derived
