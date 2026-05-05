package momo.api.endpoints.codec

import io.circe.Codec

import momo.api.domain.{OcrJobHints, PlayerAliasHint}

/**
 * Wire-format codec for OCR hint payloads.
 *
 * Lives at the boundary so the domain ADT (`momo.api.domain.OcrHints`) remains free of any JSON
 * library dependency. The on-wire JSON shape (field names and order) must stay byte-identical to
 * what the OCR worker and the web client expect, so this object only exposes derived `Codec`s
 * over the case class declarations themselves.
 */
object OcrHintsCodec:
  given Codec.AsObject[PlayerAliasHint] = Codec.AsObject.derived
  given Codec.AsObject[OcrJobHints] = Codec.AsObject.derived
