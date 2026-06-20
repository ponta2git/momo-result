package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchDraftsRepository,
  SeasonMastersRepository,
}
import momo.api.usecases.syntax.MatchDraftForeignKeyValidation
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class UpdateMatchDraftCommand(
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[GameTitleId],
    layoutFamily: Option[String],
    seasonMasterId: Option[SeasonMasterId],
    ownerMemberId: Option[MemberId],
    mapMasterId: Option[MapMasterId],
    playedAt: Option[Instant],
    status: Option[MatchDraftStatus],
)

final class UpdateMatchDraft[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    now: F[Instant],
):
  def run(
      draftId: MatchDraftId,
      command: UpdateMatchDraftCommand,
  ): F[Either[AppError, MatchDraft]] = (for
    existing <- matchDrafts.find(draftId).orNotFound("match draft", draftId.value)
    _ <- EitherT.fromEither[F](ensureEditable(existing.status))
    matchNoInEvent <- EitherT.fromEither[F](validateMatchNo(command.matchNoInEvent))
    layoutFamily <- EitherT
      .fromEither[F](UseCaseField.optionalStableKey("layoutFamily", command.layoutFamily))
    _ <- validateForeignKeys(nextReferences(command, existing))
    status <- EitherT.fromEither[F](resolveStatus(command.status, existing.status))
    at <- EitherT.liftF(now)
    updated <- EitherT.fromEither[F](
      existing match
        case e: MatchDraft.Editable => MatchDraft.editable(
            e.common.copy(
              heldEventId = command.heldEventId.orElse(e.heldEventId),
              matchNoInEvent = matchNoInEvent.orElse(e.matchNoInEvent),
              gameTitleId = command.gameTitleId.orElse(e.gameTitleId),
              layoutFamily = layoutFamily.orElse(e.layoutFamily),
              seasonMasterId = command.seasonMasterId.orElse(e.seasonMasterId),
              ownerMemberId = command.ownerMemberId.orElse(e.ownerMemberId),
              mapMasterId = command.mapMasterId.orElse(e.mapMasterId),
              playedAt = command.playedAt.orElse(e.playedAt),
            ),
            status = status,
          ).leftMap(err => AppError.ValidationFailed(err.message))
        case _ => Left(AppError.Conflict(s"match draft in status=${existing.status
              .wire} cannot be edited."))
    )
    _ <- matchDrafts.update(updated, at).ensureF(AppError.Conflict(
      "match draft was changed to a terminal status before the update could be saved."
    ))
  yield updated.withCommon(_.copy(updatedAt = at))).value

  private def ensureEditable(status: MatchDraftStatus): Either[AppError, Unit] = Either.cond(
    MatchDraftStatus.userEditableStatuses.contains(status),
    (),
    AppError.Conflict(s"match draft in status=${status.wire} cannot be edited."),
  )

  private def validateMatchNo(
      matchNoInEvent: Option[Int]
  ): Either[AppError, Option[MatchNoInEvent]] = matchNoInEvent.traverse(value =>
    MatchNoInEvent.fromInt(value).left.map(err => AppError.ValidationFailed(err.message))
  )

  private def resolveStatus(
      status: Option[MatchDraftStatus],
      current: MatchDraftStatus,
  ): Either[AppError, MatchDraftStatus] = status match
    case None => Right(current)
    case Some(parsed) =>
      if MatchDraftStatus.userEditableStatuses.contains(parsed) then Right(parsed)
      else Left(AppError.Conflict(s"status ${parsed.wire} cannot be set from this endpoint."))

  private def nextReferences(
      command: UpdateMatchDraftCommand,
      existing: MatchDraft,
  ): MatchDraftForeignKeyValidation.Input = MatchDraftForeignKeyValidation.Input(
    heldEventId = command.heldEventId.orElse(existing.heldEventId),
    gameTitleId = command.gameTitleId.orElse(existing.gameTitleId),
    mapMasterId = command.mapMasterId.orElse(existing.mapMasterId),
    seasonMasterId = command.seasonMasterId.orElse(existing.seasonMasterId),
  )

  private def validateForeignKeys(
      input: MatchDraftForeignKeyValidation.Input
  ): EitherT[F, AppError, Unit] = MatchDraftForeignKeyValidation
    .validate(heldEvents, gameTitles, mapMasters, seasonMasters)(input)
