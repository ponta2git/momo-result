package momo.api.usecases.syntax

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.GameTitle
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, SeasonMastersRepository,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

/**
 * Shared foreign-key validation for match draft create/update flows.
 *
 * Input is reduced to the four FK fields that both `CreateMatchDraftCommand` and
 * `UpdateMatchDraftCommand` share. Behavior is byte-identical to the original duplicated blocks:
 * each present id is checked for existence; when both `gameTitleId` and `mapMasterId` (or
 * `seasonMasterId`) are supplied, the referenced master must belong to the supplied game title.
 */
object MatchDraftForeignKeyValidation:

  final case class Input(
      heldEventId: Option[HeldEventId],
      gameTitleId: Option[GameTitleId],
      mapMasterId: Option[MapMasterId],
      seasonMasterId: Option[SeasonMasterId],
  )

  def validate[F[_]: MonadThrow](
      heldEvents: HeldEventsRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
  )(input: Input): EitherT[F, AppError, Unit] =
    for
      _ <- input.heldEventId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => heldEvents.find(id).orNotFound("held event", id.value).void
      title <- input.gameTitleId match
        case None => EitherT.rightT[F, AppError](Option.empty[GameTitle])
        case Some(id) => gameTitles.find(id).orNotFound("game title", id.value).map(Some(_))
      _ <- input.mapMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => mapMasters.find(id).orNotFound("map master", id.value).flatMap { map =>
            title match
              case Some(t) if map.gameTitleId != t.id =>
                EitherT.leftT[F, Unit](AppError.ValidationFailed(s"mapMasterId ${map.id
                    .value} does not belong to gameTitleId ${t.id.value}."))
              case _ => EitherT.rightT[F, AppError](())
          }
      _ <- input.seasonMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => seasonMasters.find(id).orNotFound("season master", id.value)
            .flatMap { season =>
              title match
                case Some(t) if season.gameTitleId != t.id =>
                  EitherT.leftT[F, Unit](AppError.ValidationFailed(s"seasonMasterId ${season.id
                      .value} does not belong to gameTitleId ${t.id.value}."))
                case _ => EitherT.rightT[F, AppError](())
            }
    yield ()
end MatchDraftForeignKeyValidation
