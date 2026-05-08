package momo.api.http

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import fs2.Chunk
import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.headers.{`Content-Length`, `Content-Type`}
import org.http4s.{HttpApp, MediaType, Request, Response, Status}

import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

object MaxBodySizeMiddleware:
  final class RequestBodyTooLarge(limitBytes: Long)
      extends RuntimeException(s"request body exceeds ${limitBytes.toString} bytes")

  def uploadOnly[F[_]: Async](limitBytes: Long)(http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    if isUpload(request) then applyLimit(request, limitBytes, http) else http.run(request)
  }

  private def applyLimit[F[_]: Async](
      request: Request[F],
      limitBytes: Long,
      http: HttpApp[F],
  ): F[Response[F]] = request.headers.get[`Content-Length`].map(_.length) match
    case Some(length) if length > limitBytes => problem[F](limitBytes)
    case _ =>
      val limited = request.withBodyStream(limitStream(request.body, limitBytes))
      http.run(limited).handleErrorWith {
        case _: RequestBodyTooLarge => problem[F](limitBytes)
        case error => Async[F].raiseError(error)
      }

  private def limitStream[F[_]: Async](body: fs2.Stream[F, Byte], limitBytes: Long) = body.chunks
    .evalMapAccumulate(0L) { (seen, chunk) =>
      val next = seen + chunk.size.toLong
      if next > limitBytes then
        Async[F].raiseError[(Long, Chunk[Byte])](RequestBodyTooLarge(limitBytes))
      else (next, chunk).pure[F]
    }.flatMap { case (_, chunk) => fs2.Stream.chunk(chunk) }

  private def isUpload[F[_]](request: Request[F]): Boolean = request.method.name == "POST" &&
    request.uri.path.renderString == "/api/uploads/images"

  private def problem[F[_]: Async](limitBytes: Long): F[Response[F]] =
    val (status, body) = ProblemDetails
      .from(AppError.PayloadTooLarge(s"Upload request must be ${limitBytes
          .toString} bytes or smaller."))
    Response[F](Status.fromInt(status.code).getOrElse(Status.PayloadTooLarge))
      .withEntity(body.asJson).putHeaders(`Content-Type`(MediaType.application.json)).pure[F]
