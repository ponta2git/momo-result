package momo.api.http

import cats.data.Kleisli
import cats.effect.syntax.all.*
import cats.effect.{Async, Outcome}
import cats.syntax.all.*
import cats.~>
import fs2.Stream
import org.http4s.headers.`Content-Length`
import org.http4s.{HttpApp, Method}

/** HEAD never transfers content, including routing and middleware error responses. */
private[http] object HeadResponseMiddleware:
  def apply[F[_]: Async](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    if request.method.name != Method.HEAD.name then http.run(request)
    else
      // Own the response until its body resources have been released. A deferred ordinary
      // body effect could itself be skipped when the peer resets before response transmission.
      Async[F].uncancelable { poll =>
        poll(http.run(request)).flatMap { response =>
          // A HEAD rejection's body length need not equal the corresponding GET representation
          // (RFC 9110 section 8.6). Omitting this optional field avoids advertising a false size.
          discard(response.body).as(
            response.withBodyStream(Stream.empty).removeHeader[`Content-Length`]
          )
        }
      }
  }

  private def discard[F[_]: Async](body: Stream[F, Byte]): F[Unit] =
    val F = Async[F]
    // Register leading resource scopes under their normal acquisition masks, but cancel
    // before any ordinary payload effect. A checkpoint also terminates pure/infinite bodies.
    val release = F.uncancelable { poll =>
      body.chunks.evalMap(_ => F.unit).translate(new (F ~> F):
        def apply[A](effect: F[A]): F[A] = F.canceled *> poll(effect)
      ).compile.drain
    }
    // A new fiber makes the cancellation checkpoint effective inside the masked handoff.
    release.start.flatMap(_.join).flatMap {
      case Outcome.Succeeded(result) => result
      case Outcome.Errored(error) => F.raiseError(error)
      case Outcome.Canceled() => F.unit
    }
