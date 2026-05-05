package momo.api.codec

import io.circe.Codec

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
  given Codec.AsObject[PlayerAliasHint] = Codec.AsObject.derived
  given Codec.AsObject[OcrJobHints] = Codec.AsObject.derived
