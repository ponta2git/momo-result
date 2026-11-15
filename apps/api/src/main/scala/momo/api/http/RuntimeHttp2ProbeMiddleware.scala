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
 * The outer ingress authenticates the origin and removes externally supplied probe headers.
 * The transport peer is checked here too, independently of all forwarded headers.
 */
private[api] object RuntimeHttp2ProbeMiddleware:
  val Path = "/api/__momo_runtime/http2-probe"
  val HeaderName: CIString = CIString("X-Momo-Runtime-Probe")
  val HeaderValue = "v1"
  private val ParallelismWindow = 150.millis

  def apply[F[_]: Temporal](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    if isProbe(request) then
      for
        started <- Temporal[F].monotonic
        _ <- Temporal[F].sleep(ParallelismWindow)
        finished <- Temporal[F].monotonic
      yield protocolResponse(request, started, finished)
    else http.run(request)
  }

  private def isProbe[F[_]](request: Request[F]): Boolean =
    RuntimeIngressMiddleware.isLoopback(request) && request.method === Method.GET &&
      request.uri.path.renderString == Path &&
      request.headers.get(HeaderName).exists(_.head.value == HeaderValue)

  private def protocolResponse[F[_]](
      request: Request[F],
      started: FiniteDuration,
      finished: FiniteDuration,
  ): Response[F] =
    val payload = Json.obj(
      "httpVersion" -> Json.fromString(request.httpVersion.renderString),
      "startedNanos" -> Json.fromLong(started.toNanos),
      "finishedNanos" -> Json.fromLong(finished.toNanos),
    )
    Response[F](Status.Ok).withEntity(payload.noSpaces)
      .putHeaders(`Content-Type`(MediaType.application.json))

end RuntimeHttp2ProbeMiddleware
