package momo.api.http

import java.io.IOException
import java.sql.SQLException

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import org.http4s.{HttpApp, Request, Response}
import org.slf4j.LoggerFactory

import momo.api.errors.{AppError, AppException}
import momo.api.logging.SafeLog

private[http] object HttpErrorMiddleware:
  private val logger = LoggerFactory.getLogger("momo.api.http.HttpErrorMiddleware")

  def apply[F[_]: Async](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    http.run(request).handleErrorWith { error =>
      val appError = classify(error)
      logIncident[F](request, appError, error) *> problem[F](appError)
    }
  }

  private def problem[F[_]: Async](error: AppError): F[Response[F]] = HttpProblemResponse
    .fromError[F](error).pure[F]

  private def classify(error: Throwable): AppError =
    val causes = SafeLog.causeChain(error)
    causes.collectFirst { case app: AppException => app.error } match
      case Some(appError) => appError
      case _ if causes.exists(isSqlError) => AppError.DependencyFailed("Database operation failed.")
      case _ if causes.exists(isRedisError) => AppError.DependencyFailed("Queue operation failed.")
      case _ if causes.exists(isIoError) => AppError.Internal("File operation failed.")
      case _ => AppError.Internal("Unexpected server error.")

  private def logIncident[F[_]: Async](
      request: Request[?],
      appError: AppError,
      error: Throwable,
  ): F[Unit] =
    if HttpIncidentPolicy.shouldLog(appError) then
      val requestId = request.headers.get(RequestIdMiddleware.HeaderName).map(_.head.value)
        .flatMap(momo.api.domain.RequestId.sanitize).getOrElse("none")
      RequestIdMiddleware.logWithMdc[F](requestId)(log(request, appError, error))
    else Async[F].unit

  private def log(request: Request[?], appError: AppError, error: Throwable): Unit =
    val method = request.method.name
    val path = request.uri.path.renderString
    val code = appError.code
    val classes = SafeLog.throwableClasses(error)
    logger.error(
      s"HTTP request failed method=$method path=$path problemCode=$code errorClasses=$classes"
    )

  private def isSqlError(error: Throwable): Boolean = error match
    case _: SQLException => true
    case _ => false

  private def isIoError(error: Throwable): Boolean = error match
    case _: IOException => true
    case _ => false

  private def isRedisError(error: Throwable): Boolean =
    val name = error.getClass.getName.toLowerCase
    name.contains("redis") || name.contains("lettuce") || name.contains("upstash")
