package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.Member
import momo.api.domain.ids.{MemberId, UserId}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{MembersAlg, MembersRepository}

object PostgresMembers:

  val alg: MembersAlg[ConnectionIO] = new MembersAlg[ConnectionIO]:
    override def list: ConnectionIO[List[Member]] = sql"""
        SELECT id, user_id, display_name, created_at
        FROM members
        ORDER BY id
      """.query[Member].to[List]

    override def find(id: MemberId): ConnectionIO[Option[Member]] = sql"""
        SELECT id, user_id, display_name, created_at
        FROM members
        WHERE id = $id
      """.query[Member].option

    override def findByDiscordUserId(userId: UserId): ConnectionIO[Option[Member]] = sql"""
        SELECT id, user_id, display_name, created_at
        FROM members
        WHERE user_id = $userId
      """.query[Member].option
end PostgresMembers

/** Backwards-compatible class facade. */
final class PostgresMembersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MembersRepository[F]:
  private val delegate: MembersRepository[F] = MembersRepository
    .fromConnectionIO(PostgresMembers.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMembersRepository
