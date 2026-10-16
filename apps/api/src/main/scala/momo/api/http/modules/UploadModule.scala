package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import io.circe.Encoder
import org.slf4j.LoggerFactory
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.{ProblemDetails, UploadEndpoints, UploadImageResponse}
import momo.api.errors.AppError
import momo.api.http.{HttpOperation, HttpRouteContext, MultipartUpload, SecuredEndpoint}
import momo.api.ports.storage.SourceImageIdempotencyHash
import momo.api.usecases.images.UploadImage
import momo.api.util.Sha256

object UploadModule:
  final case class UseCases[F[_]](
      uploadImage: UploadImage[F],
      submissions: momo.api.usecases.ocr.OcrSubmissions[F],
  )

  private val logger = LoggerFactory.getLogger("momo.api.http.modules.UploadModule")

  private final case class UploadFingerprint(
      fileName: Option[String],
      contentType: Option[String],
      sizeBytes: Long,
      sha256: String,
  ) derives Encoder.AsObject

  def routes[F[_]: Async](
      useCases: UseCases[F],
      rateLimiter: RateLimiter[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(SecuredEndpoint
      .mutationLogic(security, UploadEndpoints.uploadImage) { member =>
        { case (idempotencyKey, parts) =>
          MultipartUpload.file(parts) match
            case Left(error) => security.toProblemF(error).map(Left(_))
            case Right(upload) =>
              val fingerprint = UploadFingerprint(
                fileName = upload.fileName,
                contentType = upload.contentType.map(_.trim.toLowerCase),
                sizeBytes = upload.bytes.length.toLong,
                sha256 = Sha256.hex(upload.bytes),
              )
              execution.replay(
                HttpOperation.UploadImage,
                idempotencyKey,
                member,
                fingerprint,
              )(
                rateLimiter.allow(s"upload:${member.accountId.value}").flatMap {
                  case false => uploadRateLimited(member.accountId.value)
                  case true =>
                    val store = idempotencyKey match
                      case Some(key) => uploadImage.runIdempotent(
                          member.accountId,
                          upload.fileName,
                          upload.contentType,
                          upload.bytes,
                          SourceImageIdempotencyHash.fromRawKey(key),
                        )
                      case None => uploadImage
                          .run(member.accountId, upload.fileName, upload.contentType, upload.bytes)
                    store
                      .flatMap {
                        case Left(error) =>
                          val finalRejection = error match
                            case _: AppError.UnsupportedMediaType | _: AppError.PayloadTooLarge =>
                              true
                            case _ => false
                          val close =
                            idempotencyKey.filter(_ => finalRejection).fold(Async[F].unit)(key =>
                              submissions.failAdmission(
                                member.accountId,
                                SourceImageIdempotencyHash.fromRawKey(key).value,
                                fingerprint.sha256,
                                upload.bytes.length
                              ).attempt.void
                            )
                          close *> security.toProblemF(error).map(Left(_))
                        case Right(image) =>
                          val event =
                            s"image_upload_accepted accountId=${member.accountId.value} " +
                              s"imageId=${image.imageId.value} mediaType=${image.mediaType} " +
                              s"sizeBytes=${image.sizeBytes.toString}"
                          Async[F].delay(logger.info(event)) *>
                            Async[F].pure(Right(UploadImageResponse.from(image)))
                      }
                }
              )
        }
      })

  private def uploadRateLimited[F[_]: Async, A](
      accountId: String
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F]
    .delay(logger.warn(s"image_upload_rate_limited accountId=$accountId")) *> Async[F].pure(Left(
    ProblemDetails.from(AppError.TooManyRequests("Too many image uploads. Try again later."))
  ))
