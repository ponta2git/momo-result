package momo.api.endpoints

import io.circe.Codec
import sttp.model.StatusCode

import momo.api.errors.AppError

final case class ProblemDetails(
    `type`: String,
    title: String,
    status: Int,
    detail: String,
    code: String,
) derives Codec.AsObject

object ProblemDetails:
  type ProblemResponse = (StatusCode, ProblemDetails)

  def from(error: AppError): ProblemResponse = statusOf(error) -> ProblemDetails(
    `type` = s"https://momo-result.local/problems/${error.code.toLowerCase}",
    title = error.title,
    status = statusOf(error).code,
    detail = error.detail,
    code = error.code,
  )

  private def statusOf(error: AppError): StatusCode = error match
    case _: AppError.Unauthorized => StatusCode.Unauthorized
    case _: AppError.Forbidden => StatusCode.Forbidden
    case _: AppError.NotFound => StatusCode.NotFound
    case _: AppError.ValidationFailed => StatusCode.UnprocessableEntity
    case _: AppError.UnsupportedMediaType => StatusCode.UnsupportedMediaType
    case _: AppError.PayloadTooLarge => StatusCode.PayloadTooLarge
    case _: AppError.Conflict => StatusCode.Conflict
    case _: AppError.TooManyRequests => StatusCode.TooManyRequests
    case _: AppError.DependencyFailed => StatusCode.ServiceUnavailable
    case _: AppError.Internal => StatusCode.InternalServerError
