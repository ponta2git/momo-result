package momo.api.http

import java.util.UUID

import cats.data.Kleisli
import cats.effect.Sync
import cats.syntax.all.*
import org.http4s.{Header, HttpApp as Http4sApp, Request, Response}
import org.slf4j.MDC
import org.typelevel.ci.CIString

import momo.api.auth.AuthHeaderNames
import momo.api.domain.RequestId

/**
 * HTTP request correlation: pick up an inbound `X-Request-Id` header (after validating its shape to
 * prevent log-injection), or mint a fresh UUID, then
 *
 *   - echo it back as a response `X-Request-Id` header so the client can reference it when
 *     reporting issues.
 *
 * The normalized request id is also written back into the request headers before routing, so Tapir
 * endpoints can thread it into background payloads (Redis, DB) without relying on thread-local MDC.
 *
 * MDC is thread-local, while request fibers can suspend and resume on different threads. Carry the
 * identifier as request data and install MDC only during a synchronous log call via `logWithMdc`.
 * A thread-local scope around a request effect leaks identifiers into other concurrent requests.
 */
object RequestIdMiddleware:
  val HeaderName: CIString = CIString(AuthHeaderNames.RequestId)
  val MdcKey: String = "request_id"

  def apply[F[_]: Sync](http: Http4sApp[F]): Http4sApp[F] = Kleisli { (request: Request[F]) =>
    val incoming = request.headers.get(HeaderName).map(_.head.value).flatMap(RequestId.sanitize)
    val effect: F[String] = incoming match
      case Some(id) => Sync[F].pure(id)
      case None => Sync[F].delay(UUID.randomUUID().toString)

    effect.flatMap { id =>
      val requestWithId = request.putHeaders(Header.Raw(HeaderName, id))
      http.run(requestWithId).map(addHeader(_, id))
    }
  }

  private def addHeader[F[_]](response: Response[F], id: String): Response[F] = response
    .putHeaders(Header.Raw(HeaderName, id))

  /**
   * Emits one synchronous log action with an explicit correlation id.
   *
   * Request handlers and stream finalizers carry the request id as data and install it only around
   * the actual log call. Installation and restoration happen on the same thread.
   */
  private[http] def logWithMdc[F[_]: Sync](id: String)(log: => Unit): F[Unit] = Sync[F].delay {
    val previous = Option(MDC.get(MdcKey))
    MDC.put(MdcKey, id)
    try log
    finally
      previous match
        case Some(value) => MDC.put(MdcKey, value)
        case None => MDC.remove(MdcKey)
  }
