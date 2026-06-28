package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

final class InMemoryMemberAliasesRepository[F[_]: Sync] private (ref: Ref[F, List[MemberAlias]])
    extends MemberAliasesRepository[F]:
  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] = ref.get.map { all =>
    memberId match
      case Some(id) => all.filter(_.memberId == id)
      case None => all
  }
  override def find(id: MemberAliasId): F[Option[MemberAlias]] = ref.get.map(_.find(_.id == id))
  override def create(alias: MemberAlias): F[Unit] = ref.modify { aliases =>
    if containsAliasConflict(aliases, alias, excluding = None) then
      (aliases, Left(masterConflict(s"member alias already exists: ${alias.alias}")))
    else (aliases :+ alias, Right(()))
  }.flatMap(completeUnit)
  override def update(alias: MemberAlias): F[Unit] = ref.modify { aliases =>
    if !aliases.exists(_.id == alias.id) then
      (aliases, Left(notFound("member alias", alias.id.value)))
    else if containsAliasConflict(aliases, alias, excluding = Some(alias.id)) then
      (aliases, Left(masterConflict(s"member alias already exists: ${alias.alias}")))
    else (aliases.map(existing => if existing.id == alias.id then alias else existing), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: MemberAliasId): F[Unit] = ref.modify { aliases =>
    if aliases.exists(_.id == id) then (aliases.filterNot(_.id == id), Right(()))
    else (aliases, Left(notFound("member alias", id.value)))
  }.flatMap(completeUnit)

  private def containsAliasConflict(
      aliases: List[MemberAlias],
      alias: MemberAlias,
      excluding: Option[MemberAliasId],
  ): Boolean = aliases.exists(existing =>
    !excluding.contains(existing.id) && (existing.id == alias.id || existing.alias == alias.alias)
  )

object InMemoryMemberAliasesRepository:
  def create[F[_]: Sync]: F[InMemoryMemberAliasesRepository[F]] = Ref.of[F, List[MemberAlias]](Nil)
    .map(new InMemoryMemberAliasesRepository(_))
