package momo.api.usecases

import java.time.Instant

import cats.data.EitherT
import cats.effect.Sync
import cats.syntax.all.*

import momo.api.domain.ids.{ImageId, MemberId}
import momo.api.errors.AppError
import momo.api.repositories.{ImageStore, MatchDraftsRepository}

enum MatchDraftSourceImageKind(val wire: String) derives CanEqual:
  case TotalAssets extends MatchDraftSourceImageKind("total_assets")
  case Revenue extends MatchDraftSourceImageKind("revenue")
  case IncidentLog extends MatchDraftSourceImageKind("incident_log")

object MatchDraftSourceImageKind:
  def fromWire(value: String): Option[MatchDraftSourceImageKind] = values.find(_.wire == value)

final case class MatchDraftSourceImage(
    kind: MatchDraftSourceImageKind,
    contentType: Option[String],
    createdAt: Instant,
    imageUrl: String,
)

final case class MatchDraftSourceImageBinary(contentType: String, bytes: Array[Byte])

final class GetMatchDraftSourceImages[F[_]: Sync](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  def list(draftId: String, memberId: MemberId): F[Either[AppError, List[MatchDraftSourceImage]]] =
    (for
      draft <- EitherT(loadAuthorizedDraft(draftId, memberId))
      entries <- EitherT.liftF(
        List(
          MatchDraftSourceImageKind.TotalAssets -> draft.totalAssetsImageId,
          MatchDraftSourceImageKind.Revenue -> draft.revenueImageId,
          MatchDraftSourceImageKind.IncidentLog -> draft.incidentLogImageId,
        ).traverse {
          case (_, None) => Option.empty[MatchDraftSourceImage].pure[F]
          case (kind, Some(imageId)) => imageStore.find(ImageId(imageId)).map {
              case None => Option.empty[MatchDraftSourceImage]
              case Some(image) => Some(MatchDraftSourceImage(
                  kind = kind,
                  contentType = Some(image.mediaType),
                  createdAt = draft.updatedAt,
                  imageUrl = s"/api/match-drafts/$draftId/source-images/${kind.wire}",
                ))
            }
        }
      )
    yield entries.flatten).value

  def stream(
      draftId: String,
      kindWire: String,
      memberId: MemberId,
  ): F[Either[AppError, MatchDraftSourceImageBinary]] = (for
    kind <- EitherT.fromEither[F](MatchDraftSourceImageKind.fromWire(kindWire).toRight(
      AppError.ValidationFailed("kind must be total_assets, revenue, or incident_log.")
    ))
    draft <- EitherT(loadAuthorizedDraft(draftId, memberId))
    imageId <- EitherT.fromEither[F](sourceImageId(draft, kind).toRight(
      AppError.NotFound("source image", s"$draftId:${kind.wire}")
    ))
    image <- EitherT(imageStore.find(ImageId(imageId)).map(_.toRight(
      AppError.NotFound("source image", s"$draftId:${kind.wire}")
    )))
    bytes <- EitherT.liftF(Sync[F].blocking(java.nio.file.Files.readAllBytes(image.path)))
  yield MatchDraftSourceImageBinary(image.mediaType, bytes)).value

  private def loadAuthorizedDraft(
      draftId: String,
      memberId: MemberId,
  ): F[Either[AppError, momo.api.domain.MatchDraft]] = (for
    draft <-
      EitherT(matchDrafts.find(draftId).map(_.toRight(AppError.NotFound("match draft", draftId))))
    _ <- EitherT.fromEither[F](Either.cond(
      draft.createdByMemberId == memberId.value,
      (),
      AppError.Forbidden("You cannot access source images for this draft."),
    ))
  yield draft).value

  private def sourceImageId(
      draft: momo.api.domain.MatchDraft,
      kind: MatchDraftSourceImageKind,
  ): Option[String] = kind match
    case MatchDraftSourceImageKind.TotalAssets => draft.totalAssetsImageId
    case MatchDraftSourceImageKind.Revenue => draft.revenueImageId
    case MatchDraftSourceImageKind.IncidentLog => draft.incidentLogImageId
