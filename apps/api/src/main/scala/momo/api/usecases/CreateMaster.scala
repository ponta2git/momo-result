package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, MapMastersRepository, SeasonMastersRepository}

final case class CreateGameTitleCommand(id: GameTitleId, name: String, layoutFamily: String)

final class CreateGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F], now: F[Instant]):
  def run(command: CreateGameTitleCommand): F[Either[AppError, GameTitle]] =
    val validated =
      for
        id <- UseCaseField.slug("id", command.id.value)
        name <- UseCaseField.nonBlank("name", command.name)
        layoutFamily <- UseCaseField.stableKey("layoutFamily", command.layoutFamily)
      yield (GameTitleId.unsafeFromString(id), name, layoutFamily)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, name, layoutFamily)) => titles.find(id).flatMap {
          case Some(_) => MonadThrow[F]
              .pure(Left(AppError.Conflict(s"game_title with id=${id.value} already exists.")))
          case None =>
            for
              created <- now
              title = GameTitle(
                id = id,
                name = name,
                layoutFamily = layoutFamily,
                displayOrder = 0,
                createdAt = created,
              )
              inserted <- titles.createWithNextDisplayOrder(title)
            yield Right(inserted)
        }

final case class CreateMapMasterCommand(id: MapMasterId, gameTitleId: GameTitleId, name: String)

final class CreateMapMaster[F[_]: MonadThrow](
    titles: GameTitlesRepository[F],
    maps: MapMastersRepository[F],
    now: F[Instant],
):
  def run(command: CreateMapMasterCommand): F[Either[AppError, MapMaster]] =
    val validated =
      for
        id <- UseCaseField.slug("id", command.id.value)
        gameTitleId <- UseCaseField.slug("gameTitleId", command.gameTitleId.value)
        name <- UseCaseField.nonBlank("name", command.name)
      yield (MapMasterId.unsafeFromString(id), GameTitleId.unsafeFromString(gameTitleId), name)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, gameTitleId, name)) => titles.find(gameTitleId).flatMap {
          case None => MonadThrow[F].pure(Left(AppError.NotFound("game_title", gameTitleId.value)))
          case Some(_) => maps.find(id).flatMap {
              case Some(_) => MonadThrow[F]
                  .pure(Left(AppError.Conflict(s"map_master with id=${id.value} already exists.")))
              case None =>
                for
                  created <- now
                  mapMaster = MapMaster(
                    id = id,
                    gameTitleId = gameTitleId,
                    name = name,
                    displayOrder = 0,
                    createdAt = created,
                  )
                  inserted <- maps.createWithNextDisplayOrder(mapMaster)
                yield Right(inserted)
            }
        }

final case class CreateSeasonMasterCommand(
    id: SeasonMasterId,
    gameTitleId: GameTitleId,
    name: String,
)

final class CreateSeasonMaster[F[_]: MonadThrow](
    titles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
    now: F[Instant],
):
  def run(command: CreateSeasonMasterCommand): F[Either[AppError, SeasonMaster]] =
    val validated =
      for
        id <- UseCaseField.slug("id", command.id.value)
        gameTitleId <- UseCaseField.slug("gameTitleId", command.gameTitleId.value)
        name <- UseCaseField.nonBlank("name", command.name)
      yield (SeasonMasterId.unsafeFromString(id), GameTitleId.unsafeFromString(gameTitleId), name)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, gameTitleId, name)) => titles.find(gameTitleId).flatMap {
          case None => MonadThrow[F].pure(Left(AppError.NotFound("game_title", gameTitleId.value)))
          case Some(_) => seasons.find(id).flatMap {
              case Some(_) => MonadThrow[F].pure(Left(AppError.Conflict(s"season_master with id=${id
                    .value} already exists.")))
              case None =>
                for
                  created <- now
                  seasonMaster = SeasonMaster(
                    id = id,
                    gameTitleId = gameTitleId,
                    name = name,
                    displayOrder = 0,
                    createdAt = created,
                  )
                  inserted <- seasons.createWithNextDisplayOrder(seasonMaster)
                yield Right(inserted)
            }
        }
