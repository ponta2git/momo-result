package momo.api.bootstrap

import cats.effect.Async
import cats.syntax.all.*

import momo.api.endpoints.HealthEndpoints.HealthDetailsResponse

private[bootstrap] object RuntimeHealthDetails:
  def build[F[_]: Async](
      database: Option[F[Unit]],
      ocrAdmission: Option[F[String]],
  ): F[HealthDetailsResponse] =
    def check(probe: Option[F[Unit]]): F[String] = probe match
      case None => Async[F].pure("disabled")
      case Some(value) => value.attempt.map(_.fold(_ => "unavailable", _ => "ok"))

    def checkStatus(probe: Option[F[String]]): F[String] = probe match
      case None => Async[F].pure("disabled")
      case Some(value) => value.handleError(_ => "unavailable")

    (check(database), checkStatus(ocrAdmission)).mapN {
      (databaseStatus, ocrAdmissionStatus) =>
        val required = List(databaseStatus, ocrAdmissionStatus)
          .filterNot(_ == "disabled")
        val status = if required.forall(_ == "ok") then "ok" else "degraded"
        HealthDetailsResponse(status, databaseStatus, ocrAdmissionStatus)
    }
