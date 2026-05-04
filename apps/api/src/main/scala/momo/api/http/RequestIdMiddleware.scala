package momo.api.http

import java.util.UUID

import cats.data.{Kleisli, OptionT}
import cats.effect.Sync
import cats.effect.syntax.all.*
import cats.syntax.all.*
import org.http4s.{Header, HttpApp as Http4sApp, HttpRoutes as Http4sRoutes, Request, Response}
import org.slf4j.MDC
import org.typelevel.ci.CIString

/**
 * HTTP request correlation: pick up an inbound `X-Request-Id` header (after validating its shape to
 * prevent log-injection), or mint a fresh UUID, then
 *
 *   - place it in the SLF4J MDC under `request_id` for the duration of the handler so structured
 *     logs emitted on the request fiber are correlated;
 *   - echo it back as a response `X-Request-Id` header so the client can reference it when
 *     reporting issues.
 *
 * The MDC value is also surfaced via [[RequestIdLookup]] so application code (e.g.
 * [[momo.api.usecases.CreateOcrJob]]) can capture it into background payloads (Redis, DB) without
 * threading the value through every method.
 *
 * MDC is thread-local. cats-effect / Tapir typically execute the request body on the same fiber on
 * which the middleware ran, so synchronous `Sync.delay` calls inside the handler observe the value.
 * Logs emitted on other thread pools (Hikari, etc.) may not carry the MDC; that is acceptable for
 * MVP.
 */
object RequestIdMiddleware:
  val HeaderName: CIString = CIString("X-Request-Id")
  val MdcKey: String = "request_id"

  private val ValidPattern = "^[A-Za-z0-9_-]{1,64}$".r

  /** Read the current request id (if any) from MDC. */
  def lookup[F[_]: Sync]: F[Option[String]] = Sync[F]
    .delay(Option(MDC.get(MdcKey)).filter(_.nonEmpty))

  def apply[F[_]: Sync](http: Http4sApp[F]): Http4sApp[F] = Kleisli { (request: Request[F]) =>
    val incoming = request.headers.get(HeaderName).map(_.head.value).flatMap(sanitize)
    val effect: F[String] = incoming match
      case Some(id) => Sync[F].pure(id)
      case None => Sync[F].delay(UUID.randomUUID().toString)

    effect.flatMap(id => runWithMdc(id)(http.run(request)).map(addHeader(_, id)))
  }

  /** Wrap http4s `HttpRoutes` (vs HttpApp) — convenience for nested wiring. */
  def routes[F[_]: Sync](rs: Http4sRoutes[F]): Http4sRoutes[F] = Kleisli { (request: Request[F]) =>
    val incoming = request.headers.get(HeaderName).map(_.head.value).flatMap(sanitize)
    val effect: F[String] = incoming match
      case Some(id) => Sync[F].pure(id)
      case None => Sync[F].delay(UUID.randomUUID().toString)

    OptionT(effect.flatMap { id =>
      runWithMdc(id)(rs.run(request).value).map(_.map(resp => addHeader(resp, id)))
    })
  }

  private def sanitize(raw: String): Option[String] =
    val trimmed = raw.trim
    Option.when(ValidPattern.matches(trimmed))(trimmed)

  private def addHeader[F[_]](response: Response[F], id: String): Response[F] = response
    .putHeaders(Header.Raw(HeaderName, id))

  private def runWithMdc[F[_]: Sync, A](id: String)(fa: F[A]): F[A] = Sync[F]
    .delay(Option(MDC.get(MdcKey))).flatMap { previous =>
      Sync[F].delay(MDC.put(MdcKey, id)) *> fa.guarantee(Sync[F].delay {
        previous match
          case Some(v) => MDC.put(MdcKey, v)
          case None => MDC.remove(MdcKey)
      })
    }
