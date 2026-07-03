package momo.api.http

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.{Async, Clock}
import cats.syntax.all.*
import org.http4s.{HttpApp, Request, Response}
import org.slf4j.LoggerFactory

private[http] object RequestDurationLoggingMiddleware:
  private val logger = LoggerFactory.getLogger("momo.api.http.RequestDurationLoggingMiddleware")
  private val SlowThreshold = 1.second

  def apply[F[_]: Async](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    Clock[F].monotonic.flatMap { started =>
      http.run(request).attempt.flatMap {
        case Right(response) => logCompleted(request, response, started).as(response)
        case Left(error) => logFailed(request, started) *> Async[F].raiseError[Response[F]](error)
      }
    }
  }

  private def logCompleted[F[_]: Async](
      request: Request[F],
      response: Response[F],
      started: FiniteDuration,
  ): F[Unit] = Clock[F].monotonic.flatMap { finished =>
    Async[F].delay {
      val duration = finished - started
      val slow = duration >= SlowThreshold
      logger.info(
        s"http_request_completed method=${request.method.name} path=${request.uri.path.renderString} " +
          s"status=${response.status.code} durationMs=${duration.toMillis} slow=$slow"
      )
    }
  }

  private def logFailed[F[_]: Async](
      request: Request[F],
      started: FiniteDuration,
  ): F[Unit] = Clock[F].monotonic.flatMap { finished =>
    Async[F].delay {
      val duration = finished - started
      logger.warn(
        s"http_request_failed method=${request.method.name} path=${request.uri.path.renderString} " +
          s"durationMs=${duration.toMillis}"
      )
    }
  }
