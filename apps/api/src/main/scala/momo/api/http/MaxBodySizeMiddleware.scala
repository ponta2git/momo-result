package momo.api.http

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import fs2.Chunk
import org.http4s.headers.`Content-Length`
import org.http4s.{HttpApp, Request, Response}

import momo.api.endpoints.UploadPaths
import momo.api.errors.AppError

object MaxBodySizeMiddleware:
  final class RequestBodyTooLarge(limitBytes: Long)
      extends RuntimeException(s"request body exceeds ${limitBytes.toString} bytes")

  def uploadOnly[F[_]: Async](limitBytes: Long)(http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    if isUpload(request) then applyLimit(request, limitBytes, "Upload request", http)
    else http.run(request)
  }

  def requestAndUpload[F[_]: Async](requestLimitBytes: Long, uploadLimitBytes: Long)(
      http: HttpApp[F]
  ): HttpApp[F] = Kleisli { request =>
    if isUpload(request) then applyLimit(request, uploadLimitBytes, "Upload request", http)
    else if HttpMethodPredicates.isMutating(request.method) then
      applyLimit(request, requestLimitBytes, "Request body", http)
    else http.run(request)
  }

  private def applyLimit[F[_]: Async](
      request: Request[F],
      limitBytes: Long,
      label: String,
      http: HttpApp[F],
  ): F[Response[F]] = request.headers.get[`Content-Length`].map(_.length) match
    case Some(length) if length > limitBytes => problem[F](limitBytes, label)
    case _ =>
      val limited = request.withBodyStream(limitStream(request.body, limitBytes))
      http.run(limited).handleErrorWith {
        case _: RequestBodyTooLarge => problem[F](limitBytes, label)
        case error => Async[F].raiseError(error)
      }

  private def limitStream[F[_]: Async](body: fs2.Stream[F, Byte], limitBytes: Long) = body.chunks
    .evalMapAccumulate(0L) { (seen, chunk) =>
      val chunkSize = chunk.size.toLong
      if wouldExceedLimit(seen, chunkSize, limitBytes) then
        Async[F].raiseError[(Long, Chunk[Byte])](RequestBodyTooLarge(limitBytes))
      else (seen + chunkSize, chunk).pure[F]
    }.flatMap { case (_, chunk) => fs2.Stream.chunk(chunk) }

  private[http] def wouldExceedLimit(seenBytes: Long, chunkBytes: Long, limitBytes: Long): Boolean =
    chunkBytes > limitBytes - seenBytes

  private def isUpload[F[_]](request: Request[F]): Boolean = HttpMethodPredicates
    .isPost(request.method) && request.uri.path.renderString == UploadPaths.ImageUploadPath

  private def problem[F[_]: Async](limitBytes: Long, label: String): F[Response[F]] =
    val error = AppError.PayloadTooLarge(s"$label must be ${limitBytes.toString} bytes or smaller.")
    HttpProblemResponse.fromError[F](error).pure[F]
