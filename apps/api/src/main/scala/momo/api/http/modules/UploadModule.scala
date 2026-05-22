package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.{ProblemDetails, UploadEndpoints, UploadImageResponse}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, MultipartUpload}
import momo.api.usecases.UploadImage

object UploadModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.UploadModule")

  def routes[F[_]: Async](
      uploadImage: UploadImage[F],
      rateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(UploadEndpoints.uploadImage.serverLogic {
    case (accountHeader, csrfToken, parts) => security
        .authorizeMutation(accountHeader, csrfToken) { member =>
          rateLimiter.allow(s"upload:${member.accountId.value}").flatMap {
            case false => uploadRateLimited(member.accountId.value)
            case true =>
              MultipartUpload.file(parts) match
                case Left(error) => security.toProblemF(error).map(Left(_))
                case Right(upload) => uploadImage
                    .run(member.accountId, upload.fileName, upload.contentType, upload.bytes)
                    .flatMap {
                      case Left(error) => security.toProblemF(error).map(Left(_))
                      case Right(image) =>
                        val event = s"image_upload_accepted accountId=${member.accountId.value} " +
                          s"imageId=${image.imageId.value} mediaType=${image.mediaType} " +
                          s"sizeBytes=${image.sizeBytes.toString}"
                        Async[F].delay(logger.info(event)) *>
                          Async[F].pure(Right(UploadImageResponse.from(image)))
                    }
          }
        }
  })

  private def uploadRateLimited[F[_]: Async, A](
      accountId: String
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F]
    .delay(logger.warn(s"image_upload_rate_limited accountId=$accountId")) *> Async[F].pure(Left(
    ProblemDetails.from(AppError.TooManyRequests("Too many image uploads. Try again later."))
  ))
