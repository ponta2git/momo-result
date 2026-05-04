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

final case class UpdateMatchDraftCommand(
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
      draftId: MatchDraftId,
      command: UpdateMatchDraftCommand,
      memberId: MemberId,
  ): F[Either[AppError, MatchDraft]] = (for
    existing <- EitherT(
      matchDrafts.find(draftId).map(_.toRight(AppError.NotFound("match draft", draftId.value)))
    )
    _ <- EitherT.fromEither[F](authorize(existing, memberId))
    _ <- EitherT.fromEither[F](ensureEditable(existing.status))
    _ <- EitherT.fromEither[F](validateMatchNo(command.matchNoInEvent))
    _ <- validateForeignKeys(command)
    status <- EitherT.fromEither[F](resolveStatus(command.status, existing.status))
    at <- EitherT.liftF(now)
    updated <- EitherT.fromEither[F](
      existing match
        case e: MatchDraft.Editing => Right(
            e.copy(
              status = status,
              heldEventId = command.heldEventId.orElse(e.heldEventId),
              matchNoInEvent = command.matchNoInEvent.orElse(e.matchNoInEvent),
              gameTitleId = command.gameTitleId.orElse(e.gameTitleId),
              layoutFamily = command.layoutFamily.orElse(e.layoutFamily),
              seasonMasterId = command.seasonMasterId.orElse(e.seasonMasterId),
              ownerMemberId = command.ownerMemberId.orElse(e.ownerMemberId),
              mapMasterId = command.mapMasterId.orElse(e.mapMasterId),
              playedAt = command.playedAt.orElse(e.playedAt),
            )
          )
        case _ => Left(AppError.Conflict(s"match draft in status=${existing.status
              .wire} cannot be edited."))
    )
    saved <- EitherT.liftF(matchDrafts.update(updated, at))
    _ <- EitherT
      .fromEither[F](Either.cond(saved, (), AppError.NotFound("match draft", draftId.value)))
  yield updated.copy(updatedAt = at)).value

  private def authorize(draft: MatchDraft, memberId: MemberId): Either[AppError, Unit] = Either
    .cond(
      draft.createdByMemberId == memberId,
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
