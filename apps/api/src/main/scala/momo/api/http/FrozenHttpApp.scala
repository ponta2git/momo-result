package momo.api.http

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import io.circe.Json
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, HttpApp, MediaType, Method, Response, Status}
import org.typelevel.ci.CIString

private[api] object FrozenHttpApp:
  val ReadinessPath = "/api/__momo_runtime/maintenance-readiness"

  def apply[F[_]: Async](readiness: F[Unit]): HttpApp[F] = Kleisli { request =>
    val path = request.uri.path.renderString
    if request.method === Method.GET && path == ReadinessPath &&
      request.headers.get(RuntimeHttp2ProbeMiddleware.HeaderName)
        .exists(_.head.value == RuntimeHttp2ProbeMiddleware.HeaderValue)
    then readiness.attempt.map {
        case Right(_) => response(Status.Ok, "ready")
        case Left(_) => response(Status.ServiceUnavailable, "unavailable")
      }
    else if request.method === Method.GET && path == "/healthz" then
      Async[F].pure(response(Status.Ok, "maintenance"))
    else Async[F].pure(response(Status.ServiceUnavailable, "maintenance"))
  }

  private def response[F[_]](status: Status, state: String): Response[F] =
    val payload = Json.obj(
      "status" -> Json.fromString(state),
      "mode" -> Json.fromString("frozen"),
    )
    Response[F](status).withEntity(payload.noSpaces).putHeaders(
      `Content-Type`(MediaType.application.json),
      Header.Raw(CIString("Cache-Control"), "no-store"),
    )
