package momo.api.http

import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.{MediaType, Response, Status}

import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

private[http] object HttpProblemResponse:
  def fromError[F[_]](error: AppError): Response[F] =
    fromProblem(ProblemDetails.from(error))

  def fromProblem[F[_]](problem: ProblemDetails.ProblemResponse): Response[F] =
    val (status, body) = problem
    Response[F](statusFrom(status.code))
      .withEntity(body.asJson)
      .putHeaders(`Content-Type`(MediaType.application.json))

  private[http] def statusFrom(code: Int): Status =
    Status.fromInt(code).getOrElse(Status.InternalServerError)
