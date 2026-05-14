package momo.api.errors

sealed trait AppError:
  def code: String
  def title: String
  def detail: String

final class AppException(val error: AppError) extends RuntimeException(error.detail)

object AppError:
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

  final case class IdempotencyInProgress(detail: String) extends AppError:
    val code = "IDEMPOTENCY_IN_PROGRESS"
    val title = "Idempotency Key In Progress"

  final case class IdempotencyPayloadMismatch(detail: String) extends AppError:
    val code = "IDEMPOTENCY_PAYLOAD_MISMATCH"
    val title = "Idempotency Payload Mismatch"

  final case class TooManyRequests(detail: String) extends AppError:
    val code = "TOO_MANY_REQUESTS"
    val title = "Too Many Requests"

  final case class DependencyFailed(detail: String) extends AppError:
    val code = "DEPENDENCY_FAILED"
    val title = "Dependency Failed"

  final case class Internal(detail: String) extends AppError:
    val code = "INTERNAL_ERROR"
    val title = "Internal Server Error"
