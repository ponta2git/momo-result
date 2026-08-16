package momo.api.http

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.{Async, Clock}
import cats.syntax.all.*
import org.http4s.{HttpApp, Request, Response}
import org.slf4j.LoggerFactory

import momo.api.domain.RequestId

private[http] object RequestDurationLoggingMiddleware:
  private val logger = LoggerFactory.getLogger("momo.api.http.RequestDurationLoggingMiddleware")
  private val SlowThreshold = 1.second

  def apply[F[_]: Async](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    val correlationId = requestId(request)
    Clock[F].monotonic.flatMap { started =>
      http.run(request).attempt.flatMap {
        case Right(response) =>
          val method = request.method.name
          val path = request.uri.path.renderString
          val httpVersion = request.httpVersion.renderString
          val status = response.status.code
          logResponseReady(request, response, correlationId, started).as(
            response.withBodyStream(BodyTransferObserver(response.body)(result =>
              logTransferCompleted(
                method,
                path,
                httpVersion,
                status,
                correlationId,
                started,
                result,
              )
            ))
          )
        case Left(error) =>
          logFailed(request, correlationId, started) *> Async[F].raiseError[Response[F]](error)
      }
    }
  }

  private def logResponseReady[F[_]: Async](
      request: Request[F],
      response: Response[F],
      requestId: String,
      started: FiniteDuration,
  ): F[Unit] = Clock[F].monotonic.flatMap { finished =>
    RequestIdMiddleware.logWithMdc[F](requestId) {
      val duration = finished - started
      val slow = duration >= SlowThreshold
      logger.info(
        s"http_response_ready method=${request.method.name} path=${request.uri.path.renderString} " +
          s"httpVersion=${request.httpVersion.renderString} status=${response.status.code} " +
          s"requestId=$requestId " +
          s"handlerDurationMs=${duration.toMillis} slow=$slow"
      )
    }
  }

  private def logTransferCompleted[F[_]: Async](
      method: String,
      path: String,
      httpVersion: String,
      status: Int,
      requestId: String,
      requestStarted: FiniteDuration,
      result: BodyTransferResult,
  ): F[Unit] = RequestIdMiddleware.logWithMdc[F](requestId) {
    val totalDuration = result.finishedAt - requestStarted
    val message =
      s"http_response_transfer_completed method=$method path=$path httpVersion=$httpVersion " +
        s"status=$status " +
        s"requestId=$requestId " +
        s"outcome=${result.outcome.wire} bodyBytes=${result.bodyBytes.toString} " +
        s"errorClass=${result.errorClass.getOrElse("none")} " +
        s"transferDurationMs=${result.duration.toMillis} " +
        s"totalDurationMs=${totalDuration.toMillis} slow=${totalDuration >= SlowThreshold}"
    result.outcome match
      case BodyTransferOutcome.Succeeded => logger.info(message)
      case BodyTransferOutcome.Errored | BodyTransferOutcome.Canceled => logger.warn(message)
  }

  private def logFailed[F[_]: Async](
      request: Request[F],
      requestId: String,
      started: FiniteDuration,
  ): F[Unit] = Clock[F].monotonic.flatMap { finished =>
    RequestIdMiddleware.logWithMdc[F](requestId) {
      val duration = finished - started
      logger.warn(
        s"http_request_failed method=${request.method.name} path=${request.uri.path.renderString} " +
          s"httpVersion=${request.httpVersion.renderString} requestId=$requestId " +
          s"durationMs=${duration.toMillis}"
      )
    }
  }

  private def requestId[F[_]](request: Request[F]): String = request.headers
    .get(RequestIdMiddleware.HeaderName).map(_.head.value).flatMap(RequestId.sanitize)
    .getOrElse("none")
