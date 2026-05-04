package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, MapMastersRepository, SeasonMastersRepository}

/**
 * Field-level validation rules shared across master creation use cases.
 *
 * Master IDs become FKs in `matches.*_id` columns; we restrict them to lowercase alphanumerics plus
 * underscore so they remain stable, URL-safe, and trivially comparable across summit and
 * momo-result.
 */
private object MasterField:
  private val Pattern = "^[a-z][a-z0-9_]{1,63}$".r
  def slug(field: String, value: String): Either[AppError, String] =
    Pattern.pattern.matcher(value).matches() match
      case true => Right(value)
      case false => Left(AppError.ValidationFailed(
          s"$field must match ^[a-z][a-z0-9_]{1,63}$$ (lowercase, starts with a letter)."
        ))

  def nonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    if trimmed.isEmpty then Left(AppError.ValidationFailed(s"$field must not be blank."))
    else Right(trimmed)

final case class CreateGameTitleCommand(id: GameTitleId, name: String, layoutFamily: String)

final class CreateGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F], now: F[Instant]):
  def run(command: CreateGameTitleCommand): F[Either[AppError, GameTitle]] =
    val validated =
      for
        id <- MasterField.slug("id", command.id.value)
        name <- MasterField.nonBlank("name", command.name)
        layoutFamily <- MasterField.nonBlank("layoutFamily", command.layoutFamily)
      yield (GameTitleId(id), name, layoutFamily)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, name, layoutFamily)) => titles.find(id).flatMap {
          case Some(_) => MonadThrow[F]
              .pure(Left(AppError.Conflict(s"game_title with id=${id.value} already exists.")))
          case None =>
            for
              order <- titles.nextDisplayOrder
              created <- now
              title = GameTitle(
                id = id,
                name = name,
                layoutFamily = layoutFamily,
                displayOrder = order,
                createdAt = created,
              )
              _ <- titles.create(title)
            yield Right(title)
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
        id <- MasterField.slug("id", command.id.value)
        gameTitleId <- MasterField.slug("gameTitleId", command.gameTitleId.value)
        name <- MasterField.nonBlank("name", command.name)
      yield (MapMasterId(id), GameTitleId(gameTitleId), name)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, gameTitleId, name)) => titles.find(gameTitleId).flatMap {
          case None => MonadThrow[F].pure(Left(AppError.NotFound("game_title", gameTitleId.value)))
          case Some(_) => maps.find(id).flatMap {
              case Some(_) => MonadThrow[F]
                  .pure(Left(AppError.Conflict(s"map_master with id=${id.value} already exists.")))
              case None =>
                for
                  order <- maps.nextDisplayOrder(gameTitleId)
                  created <- now
                  mapMaster = MapMaster(
                    id = id,
                    gameTitleId = gameTitleId,
                    name = name,
                    displayOrder = order,
                    createdAt = created,
                  )
                  _ <- maps.create(mapMaster)
                yield Right(mapMaster)
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
        id <- MasterField.slug("id", command.id.value)
        gameTitleId <- MasterField.slug("gameTitleId", command.gameTitleId.value)
        name <- MasterField.nonBlank("name", command.name)
      yield (SeasonMasterId(id), GameTitleId(gameTitleId), name)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, gameTitleId, name)) => titles.find(gameTitleId).flatMap {
          case None => MonadThrow[F].pure(Left(AppError.NotFound("game_title", gameTitleId.value)))
          case Some(_) => seasons.find(id).flatMap {
              case Some(_) => MonadThrow[F].pure(Left(AppError.Conflict(s"season_master with id=${id
                    .value} already exists.")))
              case None =>
                for
                  order <- seasons.nextDisplayOrder(gameTitleId)
                  created <- now
                  seasonMaster = SeasonMaster(
                    id = id,
                    gameTitleId = gameTitleId,
                    name = name,
                    displayOrder = order,
                    createdAt = created,
                  )
                  _ <- seasons.create(seasonMaster)
                yield Right(seasonMaster)
            }
        }
