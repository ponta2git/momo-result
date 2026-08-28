package momo.api.usecases.common

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.GameTitle
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository,
  HeldEventsRepository,
  MapMastersRepository,
  SeasonMastersRepository
}
import momo.api.usecases.syntax.UseCaseSyntax.*

/**
 * Resolves match-owned references and enforces the map/season-to-title relationship in one place.
 * Required match flows receive the resolved title for layout projection; partial draft flows may
 * validate any effective subset without inventing placeholder ids.
 */
private[usecases] final class MatchReferenceValidation[F[_]: Monad](
    heldEvents: HeldEventsRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
):
  import MatchReferenceValidation.Input

  def validateRequired(
      heldEventId: HeldEventId,
      gameTitleId: GameTitleId,
      mapMasterId: MapMasterId,
      seasonMasterId: SeasonMasterId,
  ): EitherT[F, AppError, GameTitle] =
    for
      _ <- heldEvents.find(heldEventId).orNotFound("held event", heldEventId.value)
      title <- gameTitles.find(gameTitleId).orNotFound("game title", gameTitleId.value)
      _ <- validateMap(mapMasterId, Some(title))
      _ <- validateSeason(seasonMasterId, Some(title))
    yield title

  def validateOptional(input: Input): EitherT[F, AppError, Unit] =
    for
      _ <- input.heldEventId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => heldEvents.find(id).orNotFound("held event", id.value).void
      title <- input.gameTitleId match
        case None => EitherT.rightT[F, AppError](Option.empty[GameTitle])
        case Some(id) => gameTitles.find(id).orNotFound("game title", id.value).map(Some(_))
      _ <- input.mapMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => validateMap(id, title)
      _ <- input.seasonMasterId match
        case None => EitherT.rightT[F, AppError](())
        case Some(id) => validateSeason(id, title)
    yield ()

  private def validateMap(
      id: MapMasterId,
      title: Option[GameTitle],
  ): EitherT[F, AppError, Unit] = mapMasters.find(id).orNotFound("map master", id.value)
    .flatMap { map =>
      title match
        case Some(value) if value.id != map.gameTitleId =>
          EitherT.leftT[F, Unit](
            AppError.ValidationFailed(
              s"mapMasterId ${map.id.value} does not belong to gameTitleId ${value.id.value}."
            )
          )
        case _ => EitherT.rightT[F, AppError](())
    }

  private def validateSeason(
      id: SeasonMasterId,
      title: Option[GameTitle],
  ): EitherT[F, AppError, Unit] = seasonMasters.find(id).orNotFound("season master", id.value)
    .flatMap { season =>
      title match
        case Some(value) if value.id != season.gameTitleId =>
          EitherT.leftT[F, Unit](
            AppError.ValidationFailed(
              s"seasonMasterId ${season.id.value} does not belong to gameTitleId ${value.id.value}."
            )
          )
        case _ => EitherT.rightT[F, AppError](())
    }
end MatchReferenceValidation

private[usecases] object MatchReferenceValidation:
  final case class Input(
      heldEventId: Option[HeldEventId],
      gameTitleId: Option[GameTitleId],
      mapMasterId: Option[MapMasterId],
      seasonMasterId: Option[SeasonMasterId],
  )
end MatchReferenceValidation
