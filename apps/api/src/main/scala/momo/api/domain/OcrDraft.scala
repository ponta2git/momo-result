package momo.api.domain

import io.circe.Json
import momo.api.domain.ids.*

import java.time.Instant

final case class OcrDraft(
    id: DraftId,
    jobId: JobId,
    requestedScreenType: ScreenType,
    detectedScreenType: Option[ScreenType],
    profileId: Option[String],
    payloadJson: Json,
    warningsJson: Json,
    timingsMsJson: Json,
    createdAt: Instant,
    updatedAt: Instant
)
