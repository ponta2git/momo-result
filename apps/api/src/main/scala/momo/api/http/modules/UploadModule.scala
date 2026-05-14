package momo.api.http.modules

import cats.effect.Async
import cats.syntax.flatMap.*
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.{UploadEndpoints, UploadImageResponse}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, MultipartUpload}
import momo.api.usecases.UploadImage

object UploadModule:
  def routes[F[_]: Async](
      uploadImage: UploadImage[F],
      rateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(UploadEndpoints.uploadImage.serverLogic {
    case (accountHeader, csrfToken, parts) => security
        .authorizeMutation(accountHeader, csrfToken) { member =>
          rateLimiter.allow(s"upload:${member.accountId.value}").flatMap {
            case false => Async[F].pure(Left(
                security
                  .toProblem(AppError.TooManyRequests("Too many image uploads. Try again later."))
              ))
            case true => MultipartUpload.file(parts) match
                case Left(error) => Async[F].pure(Left(security.toProblem(error)))
                case Right(upload) => security.respond(
                    uploadImage.run(upload.fileName, upload.contentType, upload.bytes)
                  )(UploadImageResponse.from)
          }
        }
  })
