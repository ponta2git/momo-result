package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchDraftsRepository,
  SeasonMastersRepository,
}

final case class CreateMatchDraftCommand(
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[GameTitleId],
    layoutFamily: Option[String],
    seasonMasterId: Option[SeasonMasterId],
    ownerMemberId: Option[MemberId],
    mapMasterId: Option[MapMasterId],
    playedAt: Option[Instant],
    status: Option[String],
)

final class CreateMatchDraft[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    now: F[Instant],
    nextId: F[String],
):
  def run(command: CreateMatchDraftCommand, createdBy: MemberId): F[Either[AppError, MatchDraft]] =
    (for
      status <- EitherT.fromEither[F](parseStatus(command.status))
      _ <- EitherT.fromEither[F](validateMatchNo(command.matchNoInEvent))
      _ <- validateForeignKeys(command)
      id <- EitherT.liftF(nextId)
      at <- EitherT.liftF(now)
      draft = MatchDraft(
        id = MatchDraftId(id),
        createdByMemberId = createdBy,
        status = status,
        heldEventId = command.heldEventId,
        matchNoInEvent = command.matchNoInEvent,
        gameTitleId = command.gameTitleId,
        layoutFamily = command.layoutFamily,
        seasonMasterId = command.seasonMasterId,
        ownerMemberId = command.ownerMemberId,
        mapMasterId = command.mapMasterId,
        playedAt = command.playedAt,
        totalAssetsImageId = None,
        revenueImageId = None,
        incidentLogImageId = None,
        totalAssetsDraftId = None,
        revenueDraftId = None,
        incidentLogDraftId = None,
        sourceImagesRetainedUntil = None,
        sourceImagesDeletedAt = None,
        confirmedMatchId = None,
        createdAt = at,
        updatedAt = at,
      )
      _ <- EitherT.liftF(matchDrafts.create(draft))
    yield draft).value

  private def parseStatus(status: Option[String]): Either[AppError, MatchDraftStatus] = status match
    case None => Right(MatchDraftStatus.DraftReady)
    case Some(value) => MatchDraftStatus.fromWire(value).toRight(AppError.ValidationFailed(
        s"status must be one of ocr_running, ocr_failed, draft_ready, needs_review, confirmed, cancelled: $value"
      ))

  private def validateMatchNo(matchNoInEvent: Option[Int]): Either[AppError, Unit] =
    matchNoInEvent match
      case Some(value) if value <= 0 =>
        Left(AppError.ValidationFailed("matchNoInEvent must be greater than 0."))
      case _ => Right(())

  private def validateForeignKeys(command: CreateMatchDraftCommand): EitherT[F, AppError, Unit] =
    for
      _ <- command.heldEventId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => EitherT(
            heldEvents.find(id)
              .map(_.toRight(AppError.NotFound("held event", id.value)).map(_ => ()))
          )
      title <- command.gameTitleId match
        case None => EitherT.rightT[F, AppError](Option.empty[momo.api.domain.GameTitle])
        case Some(id) =>
          EitherT(gameTitles.find(id).map(_.toRight(AppError.NotFound("game title", id.value))))
            .map(Some(_))
      _ <- command.mapMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => EitherT(
            mapMasters.find(id).map(_.toRight(AppError.NotFound("map master", id.value)))
          ).flatMap { map =>
            title match
              case Some(t) if map.gameTitleId != t.id =>
                EitherT.leftT[F, Unit](AppError.ValidationFailed(s"mapMasterId ${map.id
                    .value} does not belong to gameTitleId ${t.id.value}."))
              case _ => EitherT.rightT[F, AppError](())
          }
      _ <- command.seasonMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => EitherT(
            seasonMasters.find(id).map(_.toRight(AppError.NotFound("season master", id.value)))
          ).flatMap { season =>
            title match
              case Some(t) if season.gameTitleId != t.id =>
                EitherT.leftT[F, Unit](AppError.ValidationFailed(s"seasonMasterId ${season.id
                    .value} does not belong to gameTitleId ${t.id.value}."))
              case _ => EitherT.rightT[F, AppError](())
          }
    yield ()
