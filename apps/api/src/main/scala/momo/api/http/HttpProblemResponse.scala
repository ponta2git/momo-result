package momo.api.http

import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, MediaType, Response, Status}
import org.typelevel.ci.CIString

import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

private[http] object HttpProblemResponse:
  def fromError[F[_]](error: AppError): Response[F] = fromProblem(ProblemDetails.from(error))

  def fromProblem[F[_]](problem: ProblemDetails.ProblemResponse): Response[F] =
    val (status, retryAfter, body) = problem
    val response = Response[F](statusFrom(status.code)).withEntity(body.asJson)
      .putHeaders(`Content-Type`(MediaType.application.json))
    retryAfter.fold(response)(value =>
      response.putHeaders(Header.Raw(CIString("Retry-After"), value))
    )

  private[http] def statusFrom(code: Int): Status = Status.fromInt(code)
    .getOrElse(Status.InternalServerError)
