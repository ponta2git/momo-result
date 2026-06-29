package momo.api.adapters.inmemory

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

final class InMemoryMembersRepository[F[_]: Sync] private (ref: Ref[F, Map[MemberId, Member]])
    extends MembersRepository[F]:
  override def list: F[List[Member]] = ref.get.map(_.values.toList.sortBy(_.id.value))
  override def find(id: MemberId): F[Option[Member]] = ref.get.map(_.get(id))
  override def findByDiscordUserId(userId: UserId): F[Option[Member]] = ref.get
    .map(_.values.find(_.userId == userId))

object InMemoryMembersRepository:
  def create[F[_]: Sync]: F[InMemoryMembersRepository[F]] = create(Nil)

  def create[F[_]: Sync](members: List[Member]): F[InMemoryMembersRepository[F]] = Ref
    .of[F, Map[MemberId, Member]](members.map(m => m.id -> m).toMap)
    .map(new InMemoryMembersRepository(_))
