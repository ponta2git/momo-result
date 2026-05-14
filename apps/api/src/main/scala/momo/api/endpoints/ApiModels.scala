package momo.api.endpoints

import java.time.format.DateTimeFormatter

import cats.syntax.all.*
import io.circe.{Codec, Json}
import sttp.tapir.Schema

import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, OcrJob, OcrJobHints, PlayerAliasHint, StoredImage}
import momo.api.errors.AppError

final case class AuthMeResponse(
    accountId: String,
    displayName: String,
    isAdmin: Boolean,
    memberId: Option[String],
    csrfToken: Option[String],
) derives Codec.AsObject

final case class UploadImageResponse(imageId: String, mediaType: String, sizeBytes: Long)
    derives Codec.AsObject

object UploadImageResponse:
  def from(image: StoredImage): UploadImageResponse = UploadImageResponse(
    imageId = image.imageId.value,
    mediaType = image.mediaType,
    sizeBytes = image.sizeBytes,
  )

final case class PlayerAliasHintRequest(memberId: String, aliases: List[String])
    derives Codec.AsObject

object PlayerAliasHintRequest:
  given Schema[PlayerAliasHintRequest] = Schema.derived

final case class OcrJobHintsRequest(
    gameTitle: Option[String],
    layoutFamily: Option[String],
    knownPlayerAliases: List[PlayerAliasHintRequest],
    computerPlayerAliases: List[String],
) derives Codec.AsObject:
  def asDomain: OcrJobHints = OcrJobHints(
    gameTitle = gameTitle,
    layoutFamily = layoutFamily,
    knownPlayerAliases = knownPlayerAliases
      .map(hint => PlayerAliasHint(MemberId.unsafeFromString(hint.memberId), hint.aliases)),
    computerPlayerAliases = computerPlayerAliases,
  )

object OcrJobHintsRequest:
  given Schema[OcrJobHintsRequest] = Schema.derived

final case class CreateOcrJobRequest(
    imageId: String,
    requestedScreenType: String,
    ocrHints: Option[OcrJobHintsRequest] = None,
    matchDraftId: Option[String] = None,
) derives Codec.AsObject

final case class CreateOcrJobResponse(jobId: String, draftId: String, status: String)
    derives Codec.AsObject

final case class OcrFailureResponse(
    code: String,
    message: String,
    retryable: Boolean,
    userAction: Option[String],
) derives Codec.AsObject

final case class OcrJobResponse(
    jobId: String,
    draftId: String,
    imageId: String,
    requestedScreenType: String,
    detectedScreenType: Option[String],
    status: String,
    attemptCount: Int,
    failure: Option[OcrFailureResponse],
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object OcrJobResponse:
  def from(job: OcrJob): OcrJobResponse = OcrJobResponse(
    jobId = job.id.value,
    draftId = job.draftId.value,
    imageId = job.imageId.value,
    requestedScreenType = job.requestedScreenType.wire,
    detectedScreenType = OcrJob.detectedScreenType(job).map(_.wire),
    status = job.status.wire,
    attemptCount = job.attemptCount,
    failure = OcrJob.failure(job)
      .map(f => OcrFailureResponse(f.code.wire, f.message, f.retryable, f.userAction)),
    createdAt = DateTimeFormatter.ISO_INSTANT.format(job.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(job.updatedAt),
  )

final case class OcrDraftResponse(
    draftId: String,
    jobId: String,
    requestedScreenType: String,
    detectedScreenType: Option[String],
    profileId: Option[String],
    payloadJson: Json,
    warningsJson: Json,
    timingsMsJson: Json,
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object OcrDraftResponse:
  def from(draft: OcrDraft): Either[AppError, OcrDraftResponse] = (
    parseJson(draft.payloadJson, "payloadJson"),
    parseJson(draft.warningsJson, "warningsJson"),
    parseJson(draft.timingsMsJson, "timingsMsJson"),
  ).mapN { (payload, warnings, timings) =>
    OcrDraftResponse(
      draftId = draft.id.value,
      jobId = draft.jobId.value,
      requestedScreenType = draft.requestedScreenType.wire,
      detectedScreenType = draft.detectedScreenType.map(_.wire),
      profileId = draft.profileId,
      payloadJson = payload,
      warningsJson = warnings,
      timingsMsJson = timings,
      createdAt = DateTimeFormatter.ISO_INSTANT.format(draft.createdAt),
      updatedAt = DateTimeFormatter.ISO_INSTANT.format(draft.updatedAt),
    )
  }

  private def parseJson(raw: String, fieldName: String): Either[AppError, Json] = io.circe.parser
    .parse(raw).leftMap(_ => AppError.Internal(s"Stored OCR draft $fieldName is invalid JSON."))

final case class CancelOcrJobResponse(jobId: String, status: String) derives Codec.AsObject
