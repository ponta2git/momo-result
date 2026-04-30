package momo.api.repositories.doobie

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import momo.api.domain.Member
import momo.api.repositories.MembersRepository

final class DoobieMembersRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends MembersRepository[F]:

  override def list: F[List[Member]] =
    sql"""
      SELECT id, user_id, display_name, created_at
      FROM members
      ORDER BY id
    """.query[Member].to[List].transact(xa)

  override def find(id: String): F[Option[Member]] =
    sql"""
      SELECT id, user_id, display_name, created_at
      FROM members
      WHERE id = $id
    """.query[Member].option.transact(xa)
