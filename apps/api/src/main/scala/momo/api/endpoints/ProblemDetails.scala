package momo.api.endpoints

import io.circe.Codec
import sttp.model.StatusCode
import sttp.tapir.{Schema, Validator}

import momo.api.errors.AppError

final case class ProblemDetails(
    `type`: String,
    title: String,
    status: Int,
    detail: String,
    code: String,
) derives Codec.AsObject

object ProblemDetails:
  type ProblemResponse = (StatusCode, Option[String], ProblemDetails)

  private val ProblemCodes = List(
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "VALIDATION_FAILED",
    "UNSUPPORTED_MEDIA_TYPE",
    "PAYLOAD_TOO_LARGE",
    "CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
    "IDEMPOTENCY_PAYLOAD_MISMATCH",
    "TOO_MANY_REQUESTS",
    "SERVICE_UNAVAILABLE",
    "ANALYSIS_ARTIFACT_EXPIRED",
    "ANALYSIS_SCOPE_NOT_FOUND",
    "ANALYSIS_SCOPE_NOT_IN_ARTIFACT",
    "ANALYSIS_READ_BUSY",
    "ANALYSIS_STATE_UNAVAILABLE",
    "ANALYSIS_NO_ELIGIBLE_TITLES",
    "ANALYSIS_CLIENT_UPGRADE_REQUIRED",
    "DEPENDENCY_FAILED",
    "INTERNAL_ERROR",
  )

  given Schema[ProblemDetails] = Schema.derived[ProblemDetails]
    .modify(_.code)(_.validate(Validator.enumeration(ProblemCodes, v => Some(v))))

  def from(error: AppError): ProblemResponse = (
    statusOf(error),
    retryAfter(error),
    ProblemDetails(
      `type` = s"https://momo-result.local/problems/${error.code.toLowerCase}",
      title = error.title,
      status = statusOf(error).code,
      detail = publicDetail(error),
      code = error.code,
    ),
  )

  private def retryAfter(error: AppError): Option[String] = error match
    case busy: AppError.AnalysisReadBusy => Some(busy.retryAfterSeconds.toString)
    case _ => None

  private def publicDetail(error: AppError): String = error match
    case _: AppError.Internal => "Unexpected server error."
    case _ => error.detail

  private def statusOf(error: AppError): StatusCode = error match
    case _: AppError.BadRequest => StatusCode.BadRequest
    case _: AppError.Unauthorized => StatusCode.Unauthorized
    case _: AppError.Forbidden => StatusCode.Forbidden
    case _: AppError.NotFound => StatusCode.NotFound
    case _: AppError.ValidationFailed => StatusCode.UnprocessableEntity
    case _: AppError.UnsupportedMediaType => StatusCode.UnsupportedMediaType
    case _: AppError.PayloadTooLarge => StatusCode.PayloadTooLarge
    case _: AppError.Conflict => StatusCode.Conflict
    case _: AppError.IdempotencyInProgress => StatusCode.Conflict
    case _: AppError.IdempotencyPayloadMismatch => StatusCode.Conflict
    case _: AppError.TooManyRequests => StatusCode.TooManyRequests
    case _: AppError.ServiceUnavailable => StatusCode.ServiceUnavailable
    case _: AppError.AnalysisArtifactExpired => StatusCode.Gone
    case _: AppError.AnalysisScopeNotFound => StatusCode.NotFound
    case _: AppError.AnalysisScopeNotInArtifact => StatusCode.Conflict
    case _: AppError.AnalysisReadBusy => StatusCode.ServiceUnavailable
    case _: AppError.AnalysisStateUnavailable => StatusCode.ServiceUnavailable
    case _: AppError.AnalysisNoEligibleTitles => StatusCode.Conflict
    case _: AppError.AnalysisClientUpgradeRequired => StatusCode.UpgradeRequired
    case _: AppError.DependencyFailed => StatusCode.ServiceUnavailable
    case _: AppError.Internal => StatusCode.InternalServerError
