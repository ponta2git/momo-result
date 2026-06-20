package momo.api.usecases

import java.time.Instant

import cats.data.EitherT
import cats.syntax.all.*
import cats.{Functor, MonadThrow}

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, MemberAlias, SeasonMaster}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, IncidentMastersRepository, MapMastersRepository, MemberAliasesRepository,
  MembersRepository, SeasonMastersRepository,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class UpdateGameTitleCommand(id: GameTitleId, name: String, layoutFamily: String)
final case class UpdateMapMasterCommand(id: MapMasterId, name: String)
final case class UpdateSeasonMasterCommand(id: SeasonMasterId, name: String)

final class UpdateGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F]):
  def run(command: UpdateGameTitleCommand): F[Either[AppError, GameTitle]] = (for
    existing <- titles.find(command.id).orNotFound("game title", command.id.value)
    name <- EitherT.fromEither[F](UseCaseField.nonBlank("name", command.name))
    layoutFamily <- EitherT
      .fromEither[F](UseCaseField.stableKey("layoutFamily", command.layoutFamily))
    updated = existing.copy(name = name, layoutFamily = layoutFamily)
    _ <- EitherT.liftF(titles.update(updated))
  yield updated).value

final class DeleteGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F]):
  def run(id: GameTitleId): F[Either[AppError, Unit]] = (for
    _ <- titles.find(id).orNotFound("game title", id.value)
    _ <- titles.delete(id).recoverAppError
  yield ()).value

final class UpdateMapMaster[F[_]: MonadThrow](maps: MapMastersRepository[F]):
  def run(command: UpdateMapMasterCommand): F[Either[AppError, MapMaster]] = (for
    existing <- maps.find(command.id).orNotFound("map master", command.id.value)
    name <- EitherT.fromEither[F](UseCaseField.nonBlank("name", command.name))
    updated = existing.copy(name = name)
    _ <- EitherT.liftF(maps.update(updated))
  yield updated).value

final class DeleteMapMaster[F[_]: MonadThrow](maps: MapMastersRepository[F]):
  def run(id: MapMasterId): F[Either[AppError, Unit]] = (for
    _ <- maps.find(id).orNotFound("map master", id.value)
    _ <- maps.delete(id).recoverAppError
  yield ()).value

final class UpdateSeasonMaster[F[_]: MonadThrow](seasons: SeasonMastersRepository[F]):
  def run(command: UpdateSeasonMasterCommand): F[Either[AppError, SeasonMaster]] = (for
    existing <- seasons.find(command.id).orNotFound("season master", command.id.value)
    name <- EitherT.fromEither[F](UseCaseField.nonBlank("name", command.name))
    updated = existing.copy(name = name)
    _ <- EitherT.liftF(seasons.update(updated))
  yield updated).value

final class DeleteSeasonMaster[F[_]: MonadThrow](seasons: SeasonMastersRepository[F]):
  def run(id: SeasonMasterId): F[Either[AppError, Unit]] = (for
    _ <- seasons.find(id).orNotFound("season master", id.value)
    _ <- seasons.delete(id).recoverAppError
  yield ()).value

final class ListGameTitles[F[_]](titles: GameTitlesRepository[F]):
  def run: F[List[GameTitle]] = titles.list

final class ListMapMasters[F[_]](maps: MapMastersRepository[F]):
  def run(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] = maps.list(gameTitleId)

final class ListSeasonMasters[F[_]](seasons: SeasonMastersRepository[F]):
  def run(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] = seasons.list(gameTitleId)

final class ListIncidentMasters[F[_]](incidents: IncidentMastersRepository[F]):
  def run: F[List[momo.api.domain.IncidentMaster]] = incidents.list

final case class CreateMemberAliasCommand(memberId: MemberId, alias: String)
final case class UpdateMemberAliasCommand(id: MemberAliasId, memberId: MemberId, alias: String)

final class ListMemberAliases[F[_]: Functor](aliases: MemberAliasesRepository[F]):
  def run(memberId: Option[MemberId]): F[Either[AppError, List[MemberAlias]]] = aliases
    .list(memberId).map(_.asRight[AppError])

final class CreateMemberAlias[F[_]: MonadThrow](
    aliases: MemberAliasesRepository[F],
    members: MembersRepository[F],
    now: F[Instant],
    nextId: F[MemberAliasId],
):
  def run(command: CreateMemberAliasCommand): F[Either[AppError, MemberAlias]] = (for
    alias <- EitherT.fromEither[F](validateAlias(command.alias))
    _ <- members.find(command.memberId).orNotFound("member", command.memberId.value)
    id <- EitherT.liftF(nextId)
    createdAt <- EitherT.liftF(now)
    row = MemberAlias(id = id, memberId = command.memberId, alias = alias, createdAt = createdAt)
    _ <- aliases.create(row).recoverAppError
  yield row).value

final class UpdateMemberAlias[F[_]: MonadThrow](
    aliases: MemberAliasesRepository[F],
    members: MembersRepository[F],
):
  def run(command: UpdateMemberAliasCommand): F[Either[AppError, MemberAlias]] = (for
    existing <- aliases.find(command.id).orNotFound("member alias", command.id.value)
    alias <- EitherT.fromEither[F](validateAlias(command.alias))
    _ <- members.find(command.memberId).orNotFound("member", command.memberId.value)
    updated = existing.copy(memberId = command.memberId, alias = alias)
    _ <- aliases.update(updated).recoverAppError
  yield updated).value

final class DeleteMemberAlias[F[_]: MonadThrow](aliases: MemberAliasesRepository[F]):
  def run(id: MemberAliasId): F[Either[AppError, Unit]] = (for
    _ <- aliases.find(id).orNotFound("member alias", id.value)
    _ <- aliases.delete(id).recoverAppError
  yield ()).value

private def validateAlias(value: String): Either[AppError, String] =
  val trimmed = value.trim
  Either.cond(
    trimmed.nonEmpty && trimmed.length <= 64,
    trimmed,
    AppError.ValidationFailed("alias must be 1 to 64 characters."),
  )
