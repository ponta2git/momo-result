package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.Member
import momo.api.domain.ids.{MemberId, UserId}
import momo.api.repositories.MembersRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresMembersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MembersRepository[F]:

  override def list: F[List[Member]] = sql"""
      SELECT id, user_id, display_name, created_at
      FROM members
      ORDER BY id
    """.query[Member].to[List].transact(transactor)

  override def find(id: MemberId): F[Option[Member]] = sql"""
      SELECT id, user_id, display_name, created_at
      FROM members
      WHERE id = $id
    """.query[Member].option.transact(transactor)

  override def findByDiscordUserId(userId: UserId): F[Option[Member]] = sql"""
      SELECT id, user_id, display_name, created_at
      FROM members
      WHERE user_id = $userId
    """.query[Member].option.transact(transactor)
