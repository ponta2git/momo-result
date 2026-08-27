package momo.api.errors

sealed trait AppError:
  def code: String
  def title: String
  def detail: String

final class AppException(val error: AppError) extends RuntimeException(error.detail)

object AppError:
  final case class BadRequest(detail: String) extends AppError:
    val code = "BAD_REQUEST"
    val title = "Bad Request"

  final case class Unauthorized(detail: String = "Authentication is required.") extends AppError:
    val code = "UNAUTHORIZED"
    val title = "Unauthorized"

  final case class Forbidden(detail: String) extends AppError:
    val code = "FORBIDDEN"
    val title = "Forbidden"

  final case class NotFound(resource: String, id: String) extends AppError:
    val code = "NOT_FOUND"
    val title = "Not Found"
    val detail = s"$resource was not found: $id"

  final case class ValidationFailed(detail: String) extends AppError:
    val code = "VALIDATION_FAILED"
    val title = "Validation Failed"

  final case class UnsupportedMediaType(detail: String) extends AppError:
    val code = "UNSUPPORTED_MEDIA_TYPE"
    val title = "Unsupported Media Type"

  final case class PayloadTooLarge(detail: String) extends AppError:
    val code = "PAYLOAD_TOO_LARGE"
    val title = "Payload Too Large"

  final case class Conflict(detail: String) extends AppError:
    val code = "CONFLICT"
    val title = "Conflict"

  final case class MatchNoteVersionConflict(
      detail: String = "The match note was changed by another user. Reload the latest note."
  ) extends AppError:
    val code = "MATCH_NOTE_VERSION_CONFLICT"
    val title = "Match Note Version Conflict"

  final case class IdempotencyInProgress(detail: String) extends AppError:
    val code = "IDEMPOTENCY_IN_PROGRESS"
    val title = "Idempotency Key In Progress"

  final case class IdempotencyPayloadMismatch(detail: String) extends AppError:
    val code = "IDEMPOTENCY_PAYLOAD_MISMATCH"
    val title = "Idempotency Payload Mismatch"

  final case class TooManyRequests(detail: String) extends AppError:
    val code = "TOO_MANY_REQUESTS"
    val title = "Too Many Requests"

  final case class ServiceUnavailable(detail: String) extends AppError:
    val code = "SERVICE_UNAVAILABLE"
    val title = "Service Unavailable"

  final case class AnalysisArtifactExpired(
      detail: String = "The requested analysis result is no longer available."
  ) extends AppError:
    val code = "ANALYSIS_ARTIFACT_EXPIRED"
    val title = "Analysis Result Expired"

  final case class AnalysisScopeNotFound(
      detail: String = "The requested analysis scope does not exist."
  ) extends AppError:
    val code = "ANALYSIS_SCOPE_NOT_FOUND"
    val title = "Analysis Scope Not Found"

  final case class AnalysisScopeNotInArtifact(
      detail: String = "The requested scope is not included in this analysis result."
  ) extends AppError:
    val code = "ANALYSIS_SCOPE_NOT_IN_ARTIFACT"
    val title = "Analysis Scope Not Ready"

  final case class AnalysisReadBusy(
      retryAfterSeconds: Int,
      detail: String = "Analysis results are temporarily busy. Retry shortly."
  ) extends AppError:
    val code = "ANALYSIS_READ_BUSY"
    val title = "Analysis Read Busy"

  final case class AnalysisStateUnavailable(
      detail: String = "The analysis state is temporarily unavailable."
  ) extends AppError:
    val code = "ANALYSIS_STATE_UNAVAILABLE"
    val title = "Analysis State Unavailable"

  final case class AnalysisNoEligibleTitles(
      detail: String = "There are no game titles to analyze."
  ) extends AppError:
    val code = "ANALYSIS_NO_ELIGIBLE_TITLES"
    val title = "No Eligible Titles"

  final case class AnalysisClientUpgradeRequired(
      detail: String = "Reload this page to use the current analysis API."
  ) extends AppError:
    val code = "ANALYSIS_CLIENT_UPGRADE_REQUIRED"
    val title = "Client Upgrade Required"

  final case class DependencyFailed(detail: String) extends AppError:
    val code = "DEPENDENCY_FAILED"
    val title = "Dependency Failed"

  final case class Internal(detail: String) extends AppError:
    val code = "INTERNAL_ERROR"
    val title = "Internal Server Error"
