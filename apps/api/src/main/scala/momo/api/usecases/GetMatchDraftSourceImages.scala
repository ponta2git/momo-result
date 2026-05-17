package momo.api.usecases

import java.time.Instant

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
