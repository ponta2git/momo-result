package momo.api.errors

import sttp.model.StatusCode

sealed trait AppError:
  def status: StatusCode
  def code: String
  def title: String
  def detail: String

object AppError:
  final case class Unauthorized(detail: String = "Authentication is required.") extends AppError:
    val status: StatusCode = StatusCode.Unauthorized
    val code = "UNAUTHORIZED"
    val title = "Unauthorized"

  final case class Forbidden(detail: String) extends AppError:
    val status: StatusCode = StatusCode.Forbidden
    val code = "FORBIDDEN"
    val title = "Forbidden"

  final case class NotFound(resource: String, id: String) extends AppError:
    val status: StatusCode = StatusCode.NotFound
    val code = "NOT_FOUND"
    val title = "Not Found"
    val detail = s"$resource was not found: $id"

  final case class ValidationFailed(detail: String) extends AppError:
    val status: StatusCode = StatusCode.UnprocessableEntity
    val code = "VALIDATION_FAILED"
    val title = "Validation Failed"

  final case class UnsupportedMediaType(detail: String) extends AppError:
    val status: StatusCode = StatusCode.UnsupportedMediaType
    val code = "UNSUPPORTED_MEDIA_TYPE"
    val title = "Unsupported Media Type"

  final case class PayloadTooLarge(detail: String) extends AppError:
    val status: StatusCode = StatusCode.PayloadTooLarge
    val code = "PAYLOAD_TOO_LARGE"
    val title = "Payload Too Large"

  final case class Conflict(detail: String) extends AppError:
    val status: StatusCode = StatusCode.Conflict
    val code = "CONFLICT"
    val title = "Conflict"

  final case class Internal(detail: String) extends AppError:
    val status: StatusCode = StatusCode.InternalServerError
    val code = "INTERNAL_ERROR"
    val title = "Internal Server Error"
