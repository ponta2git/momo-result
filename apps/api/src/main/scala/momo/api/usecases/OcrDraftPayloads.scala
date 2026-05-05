package momo.api.usecases

import io.circe.Json

import momo.api.domain.ScreenType

/**
 * Boundary helper that constructs the initial JSON-shaped payloads stored on a freshly enqueued
 * [[momo.api.domain.OcrDraft]]. Lives outside the domain so `OcrDraft` itself stays free of any
 * `io.circe` dependency; callers serialize once here and the domain just carries the resulting
 * raw JSON strings.
 */
private[momo] object OcrDraftPayloads:
  def initialPayload(screenType: ScreenType): String = Json.obj(
    "requested_screen_type" -> Json.fromString(screenType.wire),
    "detected_screen_type" -> Json.Null,
    "profile_id" -> Json.Null,
    "players" -> Json.arr(),
    "category_payload" -> Json.obj(),
    "warnings" -> Json.arr(),
    "raw_snippets" -> Json.Null,
  ).noSpaces

  val initialWarnings: String = Json.arr().noSpaces
  val initialTimings: String = Json.obj().noSpaces
