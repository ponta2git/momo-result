package momo.api.http

import java.io.IOException
import java.sql.SQLException

import scala.annotation.tailrec

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.{HttpApp, MediaType, Request, Response, Status}
import org.slf4j.LoggerFactory

import momo.api.endpoints.ProblemDetails
import momo.api.errors.{AppError, AppException}

private[http] object HttpErrorMiddleware:
  private val logger = LoggerFactory.getLogger("momo.api.http.HttpErrorMiddleware")

  def apply[F[_]: Async](http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    http.run(request).handleErrorWith { error =>
      val appError = classify(error)
      Async[F].delay(log(request, appError, error)) *> problem[F](appError)
    }
  }

  private def problem[F[_]: Async](error: AppError): F[Response[F]] =
    val (status, body) = ProblemDetails.from(error)
    Response[F](Status.fromInt(status.code).getOrElse(Status.InternalServerError))
      .withEntity(body.asJson).putHeaders(`Content-Type`(MediaType.application.json)).pure[F]

  private def classify(error: Throwable): AppError = findAppException(error) match
    case Some(app) => app.error
    case _ if hasCause(error)(isSqlError) => AppError.DependencyFailed("Database operation failed.")
    case _ if hasCause(error)(isRedisError) => AppError.DependencyFailed("Queue operation failed.")
    case _ if hasCause(error)(isIoError) => AppError.Internal("File operation failed.")
    case _ => AppError.Internal("Unexpected server error.")

  private def log(request: Request[?], appError: AppError, error: Throwable): Unit = logger.error(
    s"Unhandled HTTP error method=${request.method.name} path=${request.uri.path.renderString} " +
      s"problemCode=${appError.code} errorClass=${error.getClass.getName}",
    error,
  )

  private def hasCause(error: Throwable)(predicate: Throwable => Boolean): Boolean =
    findCause(error)(predicate).isDefined

  private def findAppException(error: Throwable): Option[AppException] =
    @tailrec
    def loop(current: Option[Throwable]): Option[AppException] = current match
      case None => None
      case Some(app: AppException) => Some(app)
      case Some(throwable) => loop(Option(throwable.getCause))
    loop(Some(error))

  private def findCause(error: Throwable)(predicate: Throwable => Boolean): Option[Throwable] =
    @tailrec
    def loop(current: Option[Throwable]): Option[Throwable] = current match
      case None => None
      case Some(throwable) if predicate(throwable) => Some(throwable)
      case Some(throwable) => loop(Option(throwable.getCause))
    loop(Some(error))

  private def isSqlError(error: Throwable): Boolean = error match
    case _: SQLException => true
    case _ => false

  private def isIoError(error: Throwable): Boolean = error match
    case _: IOException => true
    case _ => false

  private def isRedisError(error: Throwable): Boolean =
    val name = error.getClass.getName.toLowerCase
    name.contains("redis") || name.contains("lettuce") || name.contains("upstash")
