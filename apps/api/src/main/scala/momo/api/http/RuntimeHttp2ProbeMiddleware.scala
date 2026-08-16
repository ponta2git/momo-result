package momo.api.http

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.Temporal
import cats.syntax.all.*
import io.circe.Json
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, HttpApp, MediaType, Method, Request, Response, Status}
import org.typelevel.ci.CIString

/**
 * Loopback-only protocol oracle used by the runtime post-deploy probe.
 *
 * The public proxy removes the probe header and injects it only for loopback requests before
 * forwarding through the same h2c transport used by normal API routes.
 */
private[api] object RuntimeHttp2ProbeMiddleware:
  val Path = "/api/__momo_runtime/http2-probe"
  val HeaderName: CIString = CIString("X-Momo-Runtime-Probe")
  val HeaderValue = "v1"
  private val ParallelismWindow = 150.millis

  def apply[F[_]: Temporal](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    if isProbe(request) then
      Temporal[F].sleep(ParallelismWindow) *> Temporal[F].pure(protocolResponse(request))
    else http.run(request)
  }

  private def isProbe[F[_]](request: Request[F]): Boolean =
    request.method === Method.GET &&
      request.uri.path.renderString == Path &&
      request.headers.get(HeaderName).exists(_.head.value == HeaderValue)

  private def protocolResponse[F[_]](request: Request[F]): Response[F] =
    val payload = Json.obj(
      "httpVersion" -> Json.fromString(request.httpVersion.renderString),
    )
    Response[F](Status.Ok).withEntity(payload.noSpaces)
      .putHeaders(`Content-Type`(MediaType.application.json))

end RuntimeHttp2ProbeMiddleware
