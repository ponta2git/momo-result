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

  def from(error: AppError): ProblemResponse = error.status -> ProblemDetails(
    `type` = s"https://momo-result.local/problems/${error.code.toLowerCase}",
    title = error.title,
    status = error.status.code,
    detail = error.detail,
    code = error.code,
  )
