package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

/**
 * An OCR draft snapshot. The three JSON-shaped fields are stored as raw textual JSON so this
 * domain type remains free of any JSON library dependency. Callers at the wire/persistence
 * boundary convert to and from `io.circe.Json` (or any other representation) as needed.
 */
final case class OcrDraft(
    id: OcrDraftId,
    jobId: OcrJobId,
    requestedScreenType: ScreenType,
    detectedScreenType: Option[ScreenType],
    profileId: Option[String],
    payloadJson: String,
    warningsJson: String,
    timingsMsJson: String,
    createdAt: Instant,
    updatedAt: Instant,
)
