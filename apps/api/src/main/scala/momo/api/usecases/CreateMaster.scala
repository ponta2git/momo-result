package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, MapMastersRepository, SeasonMastersRepository}
import momo.api.usecases.syntax.UseCaseSyntax.*

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
      case Right((id, name, layoutFamily)) => (for
          created <- EitherT.liftF[F, AppError, Instant](now)
          title = GameTitle(
            id = id,
            name = name,
            layoutFamily = layoutFamily,
            displayOrder = 0,
            createdAt = created,
          )
          inserted <- titles.createWithNextDisplayOrder(title).recoverAppError
        yield inserted).value

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
      case Right((id, gameTitleId, name)) => (for
          _ <- titles.find(gameTitleId).orNotFound("game_title", gameTitleId.value)
          created <- EitherT.liftF[F, AppError, Instant](now)
          mapMaster = MapMaster(
            id = id,
            gameTitleId = gameTitleId,
            name = name,
            displayOrder = 0,
            createdAt = created,
          )
          inserted <- maps.createWithNextDisplayOrder(mapMaster).recoverAppError
        yield inserted).value

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
      case Right((id, gameTitleId, name)) => (for
          _ <- titles.find(gameTitleId).orNotFound("game_title", gameTitleId.value)
          created <- EitherT.liftF[F, AppError, Instant](now)
          seasonMaster = SeasonMaster(
            id = id,
            gameTitleId = gameTitleId,
            name = name,
            displayOrder = 0,
            createdAt = created,
          )
          inserted <- seasons.createWithNextDisplayOrder(seasonMaster).recoverAppError
        yield inserted).value
