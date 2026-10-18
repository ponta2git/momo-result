package momo.api.http

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import io.circe.Json
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, HttpApp, MediaType, Method, Response, Status}
import org.typelevel.ci.CIString

import momo.api.maintenance.DatabaseConnectionProof

private[api] object FrozenHttpApp:
  val ReadinessPath = "/api/__momo_runtime/maintenance-readiness"

  def apply[F[_]: Async](readiness: F[DatabaseConnectionProof]): HttpApp[F] = Kleisli { request =>
    val path = request.uri.path.renderString
    if request.method === Method.GET && path == ReadinessPath &&
      request.headers.get(RuntimeHttp2ProbeMiddleware.HeaderName)
        .exists(_.head.value == RuntimeHttp2ProbeMiddleware.HeaderValue)
    then
      readiness.attempt.map {
        case Right(proof) => response(Status.Ok, "ready", Some(proof))
        case Left(_) => response(Status.ServiceUnavailable, "unavailable", None)
      }
    else if request.method === Method.GET && path == "/healthz" then
      Async[F].pure(response(Status.Ok, "maintenance", None))
    else Async[F].pure(response(Status.ServiceUnavailable, "maintenance", None))
  }

  private def response[F[_]](
      status: Status,
      state: String,
      database: Option[DatabaseConnectionProof],
  ): Response[F] =
    val payload = Json.fromFields(List(
      "status" -> Json.fromString(state),
      "mode" -> Json.fromString("frozen"),
    ) ++ database.map(proof => "database" -> proof.toJson))
    Response[F](status).withEntity(payload.noSpaces).putHeaders(
      `Content-Type`(MediaType.application.json),
      Header.Raw(CIString("Cache-Control"), "no-store"),
    )
