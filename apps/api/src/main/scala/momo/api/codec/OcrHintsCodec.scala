package momo.api.codec

import java.nio.charset.StandardCharsets

import io.circe.syntax.*
import io.circe.{Codec, Decoder, DecodingFailure, Encoder, HCursor, Json, JsonObject, Printer}

import momo.api.domain.ids.MemberId
import momo.api.domain.{OcrJobHints, PlayerAliasHint}

/** Shared hint JSON boundary for HTTP acceptance and durable queue encoding. */
object OcrHintsCodec:
  val MaxUtf8Bytes = 8192
  private val printer = Printer.noSpaces.copy(dropNullValues = true, sortKeys = true)

  def encode(hints: OcrJobHints): String = printer.print(hints.asJson.deepDropNullValues)

  def validate(hints: OcrJobHints): Either[String, Unit] =
    val errors = OcrJobHints.validationErrors(hints)
    if errors.nonEmpty then Left(errors.mkString(" "))
    else if encode(hints).getBytes(StandardCharsets.UTF_8).length > MaxUtf8Bytes then
      Left(s"ocrHintsJson must be $MaxUtf8Bytes UTF-8 bytes or shorter")
    else Right(())

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
