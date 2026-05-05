package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.{ImageId, MemberId, *}
import momo.api.errors.AppError
import momo.api.repositories.{ImageStore, MatchDraftsRepository}
import momo.api.usecases.syntax.UseCaseSyntax.*

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

final class GetMatchDraftSourceImages[F[_]: MonadThrow](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  def list(
      draftId: MatchDraftId,
      memberId: MemberId,
  ): F[Either[AppError, List[MatchDraftSourceImage]]] = (for
    draft <- EitherT(loadAuthorizedDraft(draftId, memberId))
    entries <- EitherT.liftF(
      List(
        MatchDraftSourceImageKind.TotalAssets -> draft.totalAssetsImageId,
        MatchDraftSourceImageKind.Revenue -> draft.revenueImageId,
        MatchDraftSourceImageKind.IncidentLog -> draft.incidentLogImageId,
      ).traverse {
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
      kindWire: String,
      memberId: MemberId,
  ): F[Either[AppError, MatchDraftSourceImageBinary]] = (for
    kind <- EitherT.fromEither[F](MatchDraftSourceImageKind.fromWire(kindWire).toRight(
      AppError.ValidationFailed("kind must be total_assets, revenue, or incident_log.")
    ))
    draft <- EitherT(loadAuthorizedDraft(draftId, memberId))
    imageId <- EitherT.fromEither[F](sourceImageId(draft, kind).toRight(
      AppError.NotFound("source image", s"${draftId.value}:${kind.wire}")
    ))
    image <- imageStore.find(imageId).orNotFound("source image", s"${draftId.value}:${kind.wire}")
    bytes <- EitherT.liftF(imageStore.readBytes(image))
  yield MatchDraftSourceImageBinary(image.mediaType, bytes)).value

  private def loadAuthorizedDraft(
      draftId: MatchDraftId,
      memberId: MemberId,
  ): F[Either[AppError, momo.api.domain.MatchDraft]] = (for
    draft <- matchDrafts.find(draftId).orNotFound("match draft", draftId.value)
    _ <- EitherT.fromEither[F](Either.cond(
      draft.createdByMemberId == memberId,
      (),
      AppError.Forbidden("You cannot access source images for this draft."),
    ))
  yield draft).value

  private def sourceImageId(
      draft: momo.api.domain.MatchDraft,
      kind: MatchDraftSourceImageKind,
  ): Option[ImageId] = kind match
    case MatchDraftSourceImageKind.TotalAssets => draft.totalAssetsImageId
    case MatchDraftSourceImageKind.Revenue => draft.revenueImageId
    case MatchDraftSourceImageKind.IncidentLog => draft.incidentLogImageId
