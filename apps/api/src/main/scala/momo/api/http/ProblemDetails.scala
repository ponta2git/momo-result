package momo.api.http

import io.circe.Codec
import momo.api.errors.AppError
import sttp.model.StatusCode

final case class ProblemDetails(
    `type`: String,
    title: String,
    status: Int,
    detail: String,
    code: String
) derives Codec.AsObject

object ProblemDetails:
  type ErrorInfo = (StatusCode, ProblemDetails)

  def from(error: AppError): ErrorInfo =
    error.status -> ProblemDetails(
      `type` = s"https://momo-result.local/problems/${error.code.toLowerCase}",
      title = error.title,
      status = error.status.code,
      detail = error.detail,
      code = error.code
    )
