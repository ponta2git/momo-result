package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

import momo.api.domain.OcrSubmission

final case class OcrSubmissionMemberRequest(
    screenType: String,
    uploadIdempotencyKey: String,
    imageSha256: String,
    imageByteLength: Int,
) derives Codec.AsObject

final case class PutOcrSubmissionRequest(
    matchDraftId: String,
    members: List[OcrSubmissionMemberRequest],
    ocrHints: Option[OcrJobHintsRequest] = None,
) derives Codec.AsObject

final case class OcrSubmissionMemberResponse(
    screenType: String,
    status: String,
    jobId: Option[String],
    failureCode: Option[String],
) derives Codec.AsObject

final case class OcrSubmissionResponse(
    submissionId: String,
    matchDraftId: String,
    status: String,
    admissionDeadline: String,
    finishedAt: Option[String],
    members: List[OcrSubmissionMemberResponse],
) derives Codec.AsObject

object OcrSubmissionResponse:
  def from(submission: OcrSubmission): OcrSubmissionResponse = OcrSubmissionResponse(
    submission.id,
    submission.matchDraftId.value,
    submission.status,
    submission.admissionDeadline.toString,
    submission.finishedAt.map(_.toString),
    submission.members.map(m => OcrSubmissionMemberResponse(
      m.screenType.wire, m.status, m.jobId.map(_.value), m.failureCode,
    )),
  )

object OcrSubmissionEndpoints:
  val put: CommonEndpoint.SecuredMutation[(String, PutOcrSubmissionRequest), OcrSubmissionResponse] = endpoint
    .put.in("api" / "ocr-submissions" / path[String]("submissionId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(jsonBody[PutOcrSubmissionRequest]).errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[OcrSubmissionResponse]).tag("ocr")

  val get: CommonEndpoint.SecuredRead[String, OcrSubmissionResponse] = endpoint
    .get.in("api" / "ocr-submissions" / path[String]("submissionId"))
    .securityIn(CommonEndpoint.accountHeader).errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[OcrSubmissionResponse]).tag("ocr")
