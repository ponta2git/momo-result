package momo.api.http.modules

import java.security.MessageDigest
import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import io.circe.Encoder
import org.slf4j.LoggerFactory
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.{ProblemDetails, UploadEndpoints, UploadImageResponse}
import momo.api.errors.AppError
import momo.api.http.{
  EndpointSecurity,
  HttpOperation,
  IdempotencyReplay,
  MultipartUpload,
  SecuredEndpoint
}
import momo.api.usecases.images.UploadImage

object UploadModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.UploadModule")

  private final case class UploadFingerprint(
      fileName: Option[String],
      contentType: Option[String],
      sizeBytes: Long,
      sha256: String,
  ) derives Encoder.AsObject

  def routes[F[_]: Async](
      uploadImage: UploadImage[F],
      rateLimiter: RateLimiter[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(SecuredEndpoint
    .mutationLogic(security, UploadEndpoints.uploadImage) { member =>
      { case (idempotencyKey, parts) =>
        MultipartUpload.file(parts) match
          case Left(error) => security.toProblemF(error).map(Left(_))
          case Right(upload) =>
            val fingerprint = UploadFingerprint(
              fileName = upload.fileName,
              contentType = upload.contentType.map(_.trim.toLowerCase),
              sizeBytes = upload.bytes.length.toLong,
              sha256 = sha256Hex(upload.bytes),
            )
            IdempotencyReplay.wrap[F, UploadFingerprint, UploadImageResponse](
              idempotency,
              idempotencyKey,
              member,
              HttpOperation.UploadImage,
              fingerprint,
              nowF,
              rateLimiter.allow(s"upload:${member.accountId.value}").flatMap {
                case false => uploadRateLimited(member.accountId.value)
                case true => uploadImage
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
              },
            )
      }
    })

  private def sha256Hex(bytes: Array[Byte]): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).map(byte => f"${byte & 0xff}%02x").mkString

  private def uploadRateLimited[F[_]: Async, A](
      accountId: String
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F]
    .delay(logger.warn(s"image_upload_rate_limited accountId=$accountId")) *> Async[F].pure(Left(
    ProblemDetails.from(AppError.TooManyRequests("Too many image uploads. Try again later."))
  ))
