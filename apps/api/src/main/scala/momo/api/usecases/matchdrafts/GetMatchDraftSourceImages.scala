package momo.api.usecases.matchdrafts

import java.io.ByteArrayOutputStream
import java.time.format.DateTimeFormatter
import java.time.{Instant, ZoneId}
import java.util.zip.{ZipEntry, ZipOutputStream}

import cats.data.EitherT
import cats.effect.{Async, Resource}
import cats.syntax.all.*
import fs2.{Chunk, Stream}
import org.slf4j.LoggerFactory

import momo.api.domain.ids.{ImageId, *}
import momo.api.domain.{ScreenType, StoredImage}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.MatchDraftsRepository
import momo.api.usecases.syntax.UseCaseSyntax.*

enum MatchDraftSourceImageKind(val wire: String) derives CanEqual:
  case TotalAssets extends MatchDraftSourceImageKind("total_assets")
  case Revenue extends MatchDraftSourceImageKind("revenue")
  case IncidentLog extends MatchDraftSourceImageKind("incident_log")

  def screenType: ScreenType = this match
    case TotalAssets => ScreenType.TotalAssets
    case Revenue => ScreenType.Revenue
    case IncidentLog => ScreenType.IncidentLog

object MatchDraftSourceImageKind:
  def fromWire(value: String): Option[MatchDraftSourceImageKind] = values.find(_.wire == value)

final case class MatchDraftSourceImage(
    kind: MatchDraftSourceImageKind,
    imageId: ImageId,
    contentType: Option[String],
    createdAt: Instant,
)

final case class MatchDraftSourceImageBinary[F[_]](
    contentType: String,
    bodyBytes: Long,
    body: Stream[F, Byte],
)

final case class MatchDraftSourceImageArchive[F[_]](
    contentType: String,
    fileName: String,
    body: Stream[F, Byte],
    sourceBytes: Long,
    imageCount: Int,
)

final class GetMatchDraftSourceImages[F[_]: Async](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStorage[F],
    sourceImageArchiveMaxBytes: Long = GetMatchDraftSourceImages.DefaultArchiveMaxBytes,
):
  private val logger = LoggerFactory.getLogger("momo.api.usecases.GetMatchDraftSourceImages")

  def list(draftId: MatchDraftId): F[Either[AppError, List[MatchDraftSourceImage]]] = (for
    draft <- EitherT(loadDraft(draftId))
    entries <-
      if draft.sourceImagesDeletedAt.nonEmpty then
        EitherT.rightT[F, AppError](List.empty[Option[MatchDraftSourceImage]])
      else
        EitherT.liftF(
          MatchDraftSourceImageKind.values.toList
            .map(kind => kind -> draft.sourceImageId(kind.screenType)).traverse {
              case (_, None) => Option.empty[MatchDraftSourceImage].pure[F]
              case (kind, Some(imageId)) => imageStore.find(imageId).map {
                  case None => Option.empty[MatchDraftSourceImage]
                  case Some(image) => Some(MatchDraftSourceImage(
                      kind = kind,
                      imageId = image.imageId,
                      contentType = Some(image.mediaType),
                      createdAt = draft.updatedAt,
                    ))
                }
            }
        )
  yield entries.flatten).value

  def stream(
      draftId: MatchDraftId,
      kind: MatchDraftSourceImageKind,
      expectedImageId: Option[ImageId],
  ): F[Either[AppError, MatchDraftSourceImageBinary[F]]] = (for
    draft <- EitherT(loadDraft(draftId))
    _ <- EitherT.cond[F](
      draft.sourceImagesDeletedAt.isEmpty,
      (),
      AppError.NotFound("source image", s"${draftId.value}:${kind.wire}"),
    )
    imageId <- EitherT.fromEither[F](sourceImageId(draft, kind).toRight(
      AppError.NotFound("source image", s"${draftId.value}:${kind.wire}")
    ))
    _ <- EitherT.cond[F](
      expectedImageId.forall(_ == imageId),
      (),
      AppError.Conflict("Source image changed. Reload the draft to review the current image."),
    )
    image <- imageStore.find(imageId).orNotFound("source image", s"${draftId.value}:${kind.wire}")
  yield MatchDraftSourceImageBinary(
    contentType = image.mediaType,
    bodyBytes = image.sizeBytes,
    body = imageStore.readStream(image),
  )).value

  def archive(
      draftId: MatchDraftId,
      accountId: AccountId,
      expectedUpdatedAt: Option[Instant],
  ): F[Either[AppError, MatchDraftSourceImageArchive[F]]] = (for
    draft <- EitherT(loadDraft(draftId))
    _ <- EitherT.cond[F](
      draft.sourceImagesDeletedAt.isEmpty,
      (),
      AppError.NotFound("source images", draftId.value),
    )
    _ <- EitherT.cond[F](
      expectedUpdatedAt.forall(_.equals(draft.updatedAt)),
      (),
      AppError.Conflict("Draft changed. Reload it before downloading source images."),
    )
    sources <- EitherT.liftF(archiveSources(draft))
    _ <- EitherT.cond[F](sources.nonEmpty, (), AppError.NotFound("source images", draftId.value))
    totalSourceBytes = sources.foldMap(_.image.sizeBytes)
    allowed <- EitherT.liftF(Async[F].delay {
      val allowed = totalSourceBytes <= sourceImageArchiveMaxBytes
      if !allowed then
        logger.warn(s"source_image_archive_rejected accountId=${accountId.value} draftId=${draftId
            .value} sourceBytes=${totalSourceBytes.toString} maxBytes=${sourceImageArchiveMaxBytes
            .toString} imageCount=${sources.size.toString}")
      allowed
    })
    _ <- EitherT.cond[F](
      allowed,
      (),
      AppError
        .PayloadTooLarge("Source image archive is too large. Please download images individually."),
    )
  yield MatchDraftSourceImageArchive(
    contentType = "application/zip",
    fileName = archiveFileName(draft),
    body = archiveBody(sources, accountId, draftId),
    sourceBytes = totalSourceBytes,
    imageCount = sources.size,
  )).value

  private def loadDraft(draftId: MatchDraftId): F[Either[AppError, momo.api.domain.MatchDraft]] =
    (for draft <- matchDrafts.find(draftId).orNotFound("match draft", draftId.value) yield draft)
      .value

  private def sourceImageId(
      draft: momo.api.domain.MatchDraft,
      kind: MatchDraftSourceImageKind,
  ): Option[ImageId] = draft.sourceImageId(kind.screenType)

  private final case class ArchiveSource(name: String, image: StoredImage)

  private def archiveSources(draft: momo.api.domain.MatchDraft): F[List[ArchiveSource]] =
    MatchDraftSourceImageKind.values.toList.zipWithIndex.traverse { case (kind, index) =>
      draft.sourceImageId(kind.screenType) match
        case None => Option.empty[ArchiveSource].pure[F]
        case Some(imageId) => imageStore.find(imageId).flatMap {
            case None => Option.empty[ArchiveSource].pure[F]
            case Some(image) => Some(ArchiveSource(
                name = archiveEntryName(kind, index + 1, image.mediaType),
                image = image,
              )).pure[F]
          }
    }.map(_.flatten)

  private def zipStream(sources: List[ArchiveSource]): Stream[F, Byte] =
    val chunkSize = 32 * 1024
    Stream.eval(Async[F].delay(ByteArrayOutputStream(chunkSize))).flatMap { output =>
      Stream.resource(Resource.fromAutoCloseable(Async[F].delay(ZipOutputStream(output))))
        .flatMap { zip =>
          // Drain after each bounded input chunk. No response-sized buffer or background pipe
          // survives the body, and cleanup never waits for a stopped downstream reader.
          def emit(write: => Unit): Stream[F, Byte] = Stream.eval(Async[F].blocking {
            write
            val bytes = Chunk.array(output.toByteArray)
            output.reset()
            bytes
          }).flatMap(Stream.chunk)

          Stream.emits(sources).flatMap { source =>
            emit {
              val entry = ZipEntry(source.name)
              entry.setTime(0L)
              zip.putNextEntry(entry)
            } ++ imageStore.readStream(source.image).chunkN(chunkSize).flatMap { chunk =>
              emit {
                val bytes = chunk.toArraySlice
                zip.write(bytes.values, bytes.offset, bytes.length)
              }
            } ++ emit(zip.closeEntry())
          } ++ emit(zip.finish())
        }
    }

  private def archiveBody(
      sources: List[ArchiveSource],
      accountId: AccountId,
      draftId: MatchDraftId,
  ): Stream[F, Byte] = zipStream(sources).chunks.evalMapAccumulate(0L) { (seen, chunk) =>
    if chunk.size.toLong > sourceImageArchiveMaxBytes - seen then
      Async[F].raiseError[(Long, Chunk[Byte])](AppException(
        archiveTooLarge(accountId, draftId, seen + chunk.size, sources.size)
      ))
    else (seen + chunk.size, chunk).pure[F]
  }.flatMap { case (_, chunk) => Stream.chunk(chunk) }

  private def archiveTooLarge(
      accountId: AccountId,
      draftId: MatchDraftId,
      archiveBytes: Long,
      imageCount: Int,
  ): AppError =
    logger.warn(s"source_image_archive_rejected accountId=${accountId.value} draftId=${draftId
        .value} archiveBytes=${archiveBytes.toString} maxBytes=${sourceImageArchiveMaxBytes
        .toString} imageCount=${imageCount.toString}")
    AppError
      .PayloadTooLarge("Source image archive is too large. Please download images individually.")

  private def archiveEntryName(
      kind: MatchDraftSourceImageKind,
      oneBasedIndex: Int,
      mediaType: String,
  ): String =
    val label = kind match
      case MatchDraftSourceImageKind.TotalAssets => "total-assets"
      case MatchDraftSourceImageKind.Revenue => "revenue"
      case MatchDraftSourceImageKind.IncidentLog => "incident-log"
    val ext = extension(mediaType)
    f"$oneBasedIndex%02d-$label.$ext"

  private def extension(mediaType: String): String = mediaType match
    case "image/png" => "png"
    case "image/jpeg" => "jpg"
    case "image/webp" => "webp"
    case _ => "bin"

  private def archiveFileName(draft: momo.api.domain.MatchDraft): String =
    val date = ArchiveDate.format(draft.playedAt.getOrElse(draft.createdAt))
    draft.matchNoInEvent match
      case Some(no) => f"momo-ocr-images-$date-match-${no.value}%02d.zip"
      case None => s"momo-ocr-images-$date.zip"

  private object ArchiveDate:
    private val Formatter = DateTimeFormatter.ofPattern("yyyyMMdd")
      .withZone(ZoneId.of("Asia/Tokyo"))
    def format(value: Instant): String = Formatter.format(value)

object GetMatchDraftSourceImages:
  val DefaultArchiveMaxBytes: Long = 10L * 1024L * 1024L
