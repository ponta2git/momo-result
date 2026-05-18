package momo.api.usecases

import java.io.ByteArrayOutputStream
import java.time.format.DateTimeFormatter
import java.time.{Instant, ZoneId}
import java.util.zip.{ZipEntry, ZipOutputStream}

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ScreenType
import momo.api.domain.ids.{ImageId, *}
import momo.api.errors.AppError
import momo.api.repositories.{ImageStore, MatchDraftsRepository}
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
    contentType: Option[String],
    createdAt: Instant,
    imageUrl: String,
)

final case class MatchDraftSourceImageBinary(contentType: String, bytes: Array[Byte])

final case class MatchDraftSourceImageArchive(
    contentType: String,
    fileName: String,
    bytes: Array[Byte],
    imageCount: Int,
)

final class GetMatchDraftSourceImages[F[_]: MonadThrow](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  def list(
      draftId: MatchDraftId,
      accountId: AccountId,
  ): F[Either[AppError, List[MatchDraftSourceImage]]] = (for
    draft <- EitherT(loadAuthorizedDraft(draftId, accountId))
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
                      contentType = Some(image.mediaType),
                      createdAt = draft.updatedAt,
                      imageUrl = s"/api/match-drafts/${draftId.value}/source-images/${kind.wire}",
                    ))
                }
            }
        )
  yield entries.flatten).value

  def stream(
      draftId: MatchDraftId,
      kind: MatchDraftSourceImageKind,
      accountId: AccountId,
  ): F[Either[AppError, MatchDraftSourceImageBinary]] = (for
    draft <- EitherT(loadAuthorizedDraft(draftId, accountId))
    _ <- EitherT.cond[F](
      draft.sourceImagesDeletedAt.isEmpty,
      (),
      AppError.NotFound("source image", s"${draftId.value}:${kind.wire}"),
    )
    imageId <- EitherT.fromEither[F](sourceImageId(draft, kind).toRight(
      AppError.NotFound("source image", s"${draftId.value}:${kind.wire}")
    ))
    image <- imageStore.find(imageId).orNotFound("source image", s"${draftId.value}:${kind.wire}")
    bytes <- EitherT.liftF(imageStore.readBytes(image))
  yield MatchDraftSourceImageBinary(image.mediaType, bytes)).value

  def archive(
      draftId: MatchDraftId,
      accountId: AccountId,
  ): F[Either[AppError, MatchDraftSourceImageArchive]] = (for
    draft <- EitherT(loadAuthorizedDraft(draftId, accountId))
    _ <- EitherT.cond[F](
      draft.sourceImagesDeletedAt.isEmpty,
      (),
      AppError.NotFound("source images", draftId.value),
    )
    entries <- EitherT.liftF(archiveEntries(draft))
    _ <- EitherT.cond[F](entries.nonEmpty, (), AppError.NotFound("source images", draftId.value))
    bytes <- EitherT.liftF(makeZip(entries))
  yield MatchDraftSourceImageArchive(
    contentType = "application/zip",
    fileName = archiveFileName(draft),
    bytes = bytes,
    imageCount = entries.size,
  )).value

  private def loadAuthorizedDraft(
      draftId: MatchDraftId,
      accountId: AccountId,
  ): F[Either[AppError, momo.api.domain.MatchDraft]] = (for
    draft <- matchDrafts.find(draftId).orNotFound("match draft", draftId.value)
    _ <- EitherT.fromEither[F](Either.cond(
      draft.createdByAccountId == accountId,
      (),
      AppError.Forbidden("You cannot access source images for this draft."),
    ))
  yield draft).value

  private def sourceImageId(
      draft: momo.api.domain.MatchDraft,
      kind: MatchDraftSourceImageKind,
  ): Option[ImageId] = draft.sourceImageId(kind.screenType)

  private final case class ArchiveEntry(name: String, bytes: Array[Byte])

  private def archiveEntries(draft: momo.api.domain.MatchDraft): F[List[ArchiveEntry]] =
    MatchDraftSourceImageKind.values.toList.zipWithIndex.traverse { case (kind, index) =>
      draft.sourceImageId(kind.screenType) match
        case None => Option.empty[ArchiveEntry].pure[F]
        case Some(imageId) => imageStore.find(imageId).flatMap {
            case None => Option.empty[ArchiveEntry].pure[F]
            case Some(image) => imageStore.readBytes(image).map(bytes =>
                Some(ArchiveEntry(
                  name = archiveEntryName(kind, index + 1, image.mediaType),
                  bytes = bytes,
                ))
              )
          }
    }.map(_.flatten)

  private def makeZip(entries: List[ArchiveEntry]): F[Array[Byte]] = MonadThrow[F].pure {
    val out = ByteArrayOutputStream()
    val zip = ZipOutputStream(out)
    try entries.foreach { entry =>
        val zipEntry = ZipEntry(entry.name)
        zipEntry.setTime(0L)
        zip.putNextEntry(zipEntry)
        zip.write(entry.bytes)
        zip.closeEntry()
      }
    finally zip.close()
    out.toByteArray
  }

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
