package momo.api.usecases

import java.sql.SQLException
import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, MapMaster, MemberAlias, SeasonMaster}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, MapMastersRepository, MemberAliasesRepository, MembersRepository,
  SeasonMastersRepository,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class UpdateGameTitleCommand(id: GameTitleId, name: String, layoutFamily: String)
final case class UpdateMapMasterCommand(id: MapMasterId, name: String)
final case class UpdateSeasonMasterCommand(id: SeasonMasterId, name: String)

final class UpdateGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F]):
  def run(command: UpdateGameTitleCommand): F[Either[AppError, GameTitle]] = (for
    existing <- titles.find(command.id).orNotFound("game title", command.id.value)
    name <- EitherT.fromEither[F](MasterField.nonBlank("name", command.name))
    layoutFamily <- EitherT.fromEither[F](MasterField.nonBlank("layoutFamily", command.layoutFamily))
    updated = existing.copy(name = name, layoutFamily = layoutFamily)
    _ <- EitherT.liftF(titles.update(updated))
  yield updated).value

final class DeleteGameTitle[F[_]: MonadThrow](titles: GameTitlesRepository[F]):
  def run(id: GameTitleId): F[Either[AppError, Unit]] = (for
    _ <- titles.find(id).orNotFound("game title", id.value)
    _ <- deleteRestricted(titles.delete(id), "game title is still referenced.")
  yield ()).value

final class UpdateMapMaster[F[_]: MonadThrow](maps: MapMastersRepository[F]):
  def run(command: UpdateMapMasterCommand): F[Either[AppError, MapMaster]] = (for
    existing <- maps.find(command.id).orNotFound("map master", command.id.value)
    name <- EitherT.fromEither[F](MasterField.nonBlank("name", command.name))
    updated = existing.copy(name = name)
    _ <- EitherT.liftF(maps.update(updated))
  yield updated).value

final class DeleteMapMaster[F[_]: MonadThrow](maps: MapMastersRepository[F]):
  def run(id: MapMasterId): F[Either[AppError, Unit]] = (for
    _ <- maps.find(id).orNotFound("map master", id.value)
    _ <- deleteRestricted(maps.delete(id), "map master is still referenced.")
  yield ()).value

final class UpdateSeasonMaster[F[_]: MonadThrow](seasons: SeasonMastersRepository[F]):
  def run(command: UpdateSeasonMasterCommand): F[Either[AppError, SeasonMaster]] = (for
    existing <- seasons.find(command.id).orNotFound("season master", command.id.value)
    name <- EitherT.fromEither[F](MasterField.nonBlank("name", command.name))
    updated = existing.copy(name = name)
    _ <- EitherT.liftF(seasons.update(updated))
  yield updated).value

final class DeleteSeasonMaster[F[_]: MonadThrow](seasons: SeasonMastersRepository[F]):
  def run(id: SeasonMasterId): F[Either[AppError, Unit]] = (for
    _ <- seasons.find(id).orNotFound("season master", id.value)
    _ <- deleteRestricted(seasons.delete(id), "season master is still referenced.")
  yield ()).value

final case class CreateMemberAliasCommand(memberId: String, alias: String)
final case class UpdateMemberAliasCommand(id: String, memberId: String, alias: String)

final class ListMemberAliases[F[_]: MonadThrow](aliases: MemberAliasesRepository[F]):
  def run(memberId: Option[String]): F[Either[AppError, List[MemberAlias]]] =
    memberId.traverse(validateMemberId) match
      case Left(error) => MonadThrow[F].pure(Left(error))
      case Right(id) => aliases.list(id).map(_.asRight[AppError])

final class CreateMemberAlias[F[_]: MonadThrow](
    aliases: MemberAliasesRepository[F],
    members: MembersRepository[F],
    now: F[Instant],
    nextId: F[String],
):
  def run(command: CreateMemberAliasCommand): F[Either[AppError, MemberAlias]] = (for
    memberId <- EitherT.fromEither[F](validateMemberId(command.memberId))
    alias <- EitherT.fromEither[F](validateAlias(command.alias))
    _ <- members.find(memberId).orNotFound("member", memberId.value)
    _ <- ensureAliasAvailable(aliases, alias, exceptId = None)
    id <- EitherT.liftF(nextId)
    createdAt <- EitherT.liftF(now)
    row = MemberAlias(id = id, memberId = memberId, alias = alias, createdAt = createdAt)
    _ <- EitherT.liftF(aliases.create(row))
  yield row).value

final class UpdateMemberAlias[F[_]: MonadThrow](
    aliases: MemberAliasesRepository[F],
    members: MembersRepository[F],
):
  def run(command: UpdateMemberAliasCommand): F[Either[AppError, MemberAlias]] = (for
    existing <- aliases.find(command.id).orNotFound("member alias", command.id)
    memberId <- EitherT.fromEither[F](validateMemberId(command.memberId))
    alias <- EitherT.fromEither[F](validateAlias(command.alias))
    _ <- members.find(memberId).orNotFound("member", memberId.value)
    _ <- ensureAliasAvailable(aliases, alias, exceptId = Some(existing.id))
    updated = existing.copy(memberId = memberId, alias = alias)
    _ <- EitherT.liftF(aliases.update(updated))
  yield updated).value

final class DeleteMemberAlias[F[_]: MonadThrow](aliases: MemberAliasesRepository[F]):
  def run(id: String): F[Either[AppError, Unit]] = (for
    _ <- aliases.find(id).orNotFound("member alias", id)
    _ <- EitherT.liftF(aliases.delete(id))
  yield ()).value

private def validateMemberId(value: String): Either[AppError, MemberId] =
  val trimmed = value.trim
  Either.cond(
    trimmed.nonEmpty,
    MemberId(trimmed),
    AppError.ValidationFailed("memberId must not be blank."),
  )

private def validateAlias(value: String): Either[AppError, String] =
  val trimmed = value.trim
  Either.cond(
    trimmed.nonEmpty && trimmed.length <= 64,
    trimmed,
    AppError.ValidationFailed("alias must be 1 to 64 characters."),
  )

private def ensureAliasAvailable[F[_]: MonadThrow](
    aliases: MemberAliasesRepository[F],
    alias: String,
    exceptId: Option[String],
): EitherT[F, AppError, Unit] = EitherT {
  aliases.list(None).map { all =>
    val duplicate = all.exists(row => row.alias == alias && !exceptId.contains(row.id))
    Either.cond(
      !duplicate,
      (),
      AppError.Conflict(s"member alias already exists: $alias"),
    )
  }
}

private def deleteRestricted[F[_]: MonadThrow](
    action: F[Unit],
    detail: String,
): EitherT[F, AppError, Unit] = EitherT {
  action.attempt.flatMap {
    case Right(_) => MonadThrow[F].pure(Right(()))
    case Left(sql: SQLException) if sql.getSQLState == "23503" =>
      MonadThrow[F].pure(Left(AppError.Conflict(detail)))
    case Left(error) => MonadThrow[F].raiseError[Either[AppError, Unit]](error)
  }
}
