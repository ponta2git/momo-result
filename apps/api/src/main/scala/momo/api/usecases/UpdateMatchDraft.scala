package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.{MatchDraft, MatchDraftStatus}
import momo.api.domain.ids.MemberId
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchDraftsRepository,
  SeasonMastersRepository,
}

final case class UpdateMatchDraftCommand(
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    layoutFamily: Option[String],
    seasonMasterId: Option[String],
    ownerMemberId: Option[String],
    mapMasterId: Option[String],
    playedAt: Option[Instant],
    status: Option[String],
)

final class UpdateMatchDraft[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    now: F[Instant],
):
  private val editableStatuses =
    Set(MatchDraftStatus.DraftReady, MatchDraftStatus.NeedsReview, MatchDraftStatus.OcrFailed)

  def run(
      draftId: String,
      command: UpdateMatchDraftCommand,
      memberId: MemberId,
  ): F[Either[AppError, MatchDraft]] = (for
    existing <-
      EitherT(matchDrafts.find(draftId).map(_.toRight(AppError.NotFound("match draft", draftId))))
    _ <- EitherT.fromEither[F](authorize(existing, memberId))
    _ <- EitherT.fromEither[F](ensureEditable(existing.status))
    _ <- EitherT.fromEither[F](validateMatchNo(command.matchNoInEvent))
    _ <- validateForeignKeys(command)
    status <- EitherT.fromEither[F](resolveStatus(command.status, existing.status))
    at <- EitherT.liftF(now)
    updated = existing.copy(
      status = status,
      heldEventId = command.heldEventId.orElse(existing.heldEventId),
      matchNoInEvent = command.matchNoInEvent.orElse(existing.matchNoInEvent),
      gameTitleId = command.gameTitleId.orElse(existing.gameTitleId),
      layoutFamily = command.layoutFamily.orElse(existing.layoutFamily),
      seasonMasterId = command.seasonMasterId.orElse(existing.seasonMasterId),
      ownerMemberId = command.ownerMemberId.orElse(existing.ownerMemberId),
      mapMasterId = command.mapMasterId.orElse(existing.mapMasterId),
      playedAt = command.playedAt.orElse(existing.playedAt),
    )
    saved <- EitherT.liftF(matchDrafts.update(updated, at))
    _ <- EitherT.fromEither[F](Either.cond(saved, (), AppError.NotFound("match draft", draftId)))
  yield updated.copy(updatedAt = at)).value

  private def authorize(draft: MatchDraft, memberId: MemberId): Either[AppError, Unit] = Either
    .cond(
      draft.createdByMemberId == memberId.value,
      (),
      AppError.Forbidden("You cannot update this match draft."),
    )

  private def ensureEditable(status: MatchDraftStatus): Either[AppError, Unit] = Either.cond(
    editableStatuses.contains(status),
    (),
    AppError.Conflict(s"match draft in status=${status.wire} cannot be edited."),
  )

  private def validateMatchNo(matchNoInEvent: Option[Int]): Either[AppError, Unit] =
    matchNoInEvent match
      case Some(value) if value <= 0 =>
        Left(AppError.ValidationFailed("matchNoInEvent must be greater than 0."))
      case _ => Right(())

  private def resolveStatus(
      wire: Option[String],
      current: MatchDraftStatus,
  ): Either[AppError, MatchDraftStatus] = wire match
    case None => Right(current)
    case Some(value) => MatchDraftStatus.fromWire(value)
        .toRight(AppError.ValidationFailed(s"unknown match draft status: $value")).flatMap { parsed =>
          if editableStatuses.contains(parsed) then Right(parsed)
          else Left(AppError.Conflict(s"status ${parsed.wire} cannot be set from this endpoint."))
        }

  private def validateForeignKeys(command: UpdateMatchDraftCommand): EitherT[F, AppError, Unit] =
    for
      _ <- command.heldEventId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => EitherT(
            heldEvents.find(id).map(_.toRight(AppError.NotFound("held event", id)).map(_ => ()))
          )
      title <- command.gameTitleId match
        case None => EitherT.rightT[F, AppError](Option.empty[momo.api.domain.GameTitle])
        case Some(id) =>
          EitherT(gameTitles.find(id).map(_.toRight(AppError.NotFound("game title", id))))
            .map(Some(_))
      _ <- command.mapMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => EitherT(
            mapMasters.find(id).map(_.toRight(AppError.NotFound("map master", id)))
          ).flatMap { map =>
            title match
              case Some(t) if map.gameTitleId != t.id =>
                EitherT.leftT[F, Unit](AppError.ValidationFailed(s"mapMasterId ${map
                    .id} does not belong to gameTitleId ${t.id}."))
              case _ => EitherT.rightT[F, AppError](())
          }
      _ <- command.seasonMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => EitherT(
            seasonMasters.find(id).map(_.toRight(AppError.NotFound("season master", id)))
          ).flatMap { season =>
            title match
              case Some(t) if season.gameTitleId != t.id =>
                EitherT.leftT[F, Unit](AppError.ValidationFailed(s"seasonMasterId ${season
                    .id} does not belong to gameTitleId ${t.id}."))
              case _ => EitherT.rightT[F, AppError](())
          }
    yield ()
