package momo.api.http.modules

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.endpoints.{UploadEndpoints, UploadImageResponse}
import momo.api.http.{EndpointSecurity, MultipartUpload}
import momo.api.usecases.UploadImage

object UploadModule:
  def routes[F[_]: Async](
      uploadImage: UploadImage[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    UploadEndpoints.uploadImage.serverLogic { case (devUser, csrfToken, parts) =>
      security.authorizeMutation(devUser, csrfToken) { _ =>
        MultipartUpload.file(parts) match
          case Left(error) => Async[F].pure(Left(security.toProblem(error)))
          case Right(upload) =>
            security
              .respond(uploadImage.run(upload.fileName, upload.contentType, upload.bytes))(
                UploadImageResponse.from
              )
      }
    }
  )
