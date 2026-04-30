package momo.api.usecases

import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, MapMastersRepository, SeasonMastersRepository}

/**
 * Validation shared across master ID inputs.
 *
 * Master IDs become FKs in `matches.*_id` columns; we restrict them to lowercase alphanumerics plus
 * underscore so they remain stable, URL-safe, and trivially comparable across summit and
 * momo-result.
 */
private object MasterIdValidation:
  private val Pattern = "^[a-z][a-z0-9_]{1,63}$".r
  def validate(field: String, value: String): Either[AppError, String] = Pattern.pattern
    .matcher(value).matches() match
    case true => Right(value)
    case false => Left(AppError.ValidationFailed(
        s"$field must match ^[a-z][a-z0-9_]{1,63}$$ (lowercase, starts with a letter)."
      ))

  def requireNonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    if trimmed.isEmpty then Left(AppError.ValidationFailed(s"$field must not be blank."))
    else Right(trimmed)

final case class CreateGameTitleCommand(id: String, name: String, layoutFamily: String)

final class CreateGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F], now: F[Instant]):
  def run(command: CreateGameTitleCommand): F[Either[AppError, GameTitle]] =
    val validated =
      for
        id <- MasterIdValidation.validate("id", command.id)
        name <- MasterIdValidation.requireNonBlank("name", command.name)
        lf <- MasterIdValidation.requireNonBlank("layoutFamily", command.layoutFamily)
      yield (id, name, lf)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, name, lf)) => titles.find(id).flatMap {
          case Some(_) => MonadThrow[F]
              .pure(Left(AppError.Conflict(s"game_title with id=$id already exists.")))
          case None =>
            for
              order <- titles.nextDisplayOrder
              created <- now
              title = GameTitle(
                id = id,
                name = name,
                layoutFamily = lf,
                displayOrder = order,
                createdAt = created,
              )
              _ <- titles.create(title)
            yield Right(title)
        }

final case class CreateMapMasterCommand(id: String, gameTitleId: String, name: String)

final class CreateMapMaster[F[_]: MonadThrow](
    titles: GameTitlesRepository[F],
    maps: MapMastersRepository[F],
    now: F[Instant],
):
  def run(command: CreateMapMasterCommand): F[Either[AppError, MapMaster]] =
    val validated =
      for
        id <- MasterIdValidation.validate("id", command.id)
        gtId <- MasterIdValidation.validate("gameTitleId", command.gameTitleId)
        name <- MasterIdValidation.requireNonBlank("name", command.name)
      yield (id, gtId, name)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, gtId, name)) => titles.find(gtId).flatMap {
          case None => MonadThrow[F].pure(Left(AppError.NotFound("game_title", gtId)))
          case Some(_) => maps.find(id).flatMap {
              case Some(_) => MonadThrow[F]
                  .pure(Left(AppError.Conflict(s"map_master with id=$id already exists.")))
              case None =>
                for
                  order <- maps.nextDisplayOrder(gtId)
                  created <- now
                  m = MapMaster(
                    id = id,
                    gameTitleId = gtId,
                    name = name,
                    displayOrder = order,
                    createdAt = created,
                  )
                  _ <- maps.create(m)
                yield Right(m)
            }
        }

final case class CreateSeasonMasterCommand(id: String, gameTitleId: String, name: String)

final class CreateSeasonMaster[F[_]: MonadThrow](
    titles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
    now: F[Instant],
):
  def run(command: CreateSeasonMasterCommand): F[Either[AppError, SeasonMaster]] =
    val validated =
      for
        id <- MasterIdValidation.validate("id", command.id)
        gtId <- MasterIdValidation.validate("gameTitleId", command.gameTitleId)
        name <- MasterIdValidation.requireNonBlank("name", command.name)
      yield (id, gtId, name)

    validated match
      case Left(err) => MonadThrow[F].pure(Left(err))
      case Right((id, gtId, name)) => titles.find(gtId).flatMap {
          case None => MonadThrow[F].pure(Left(AppError.NotFound("game_title", gtId)))
          case Some(_) => seasons.find(id).flatMap {
              case Some(_) => MonadThrow[F]
                  .pure(Left(AppError.Conflict(s"season_master with id=$id already exists.")))
              case None =>
                for
                  order <- seasons.nextDisplayOrder(gtId)
                  created <- now
                  s = SeasonMaster(
                    id = id,
                    gameTitleId = gtId,
                    name = name,
                    displayOrder = order,
                    createdAt = created,
                  )
                  _ <- seasons.create(s)
                yield Right(s)
            }
        }
