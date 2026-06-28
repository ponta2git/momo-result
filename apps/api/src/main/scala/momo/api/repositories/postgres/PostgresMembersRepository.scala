package momo.api.repositories.postgres

import java.time.Instant

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
  private final case class MemberRow(
      id: MemberId,
      userId: UserId,
      displayName: String,
      createdAt: Instant,
  )

  private val selectAll = fr"SELECT id, user_id, display_name, created_at FROM members"

  private def fromRow(row: MemberRow): Member = Member(
    id = row.id,
    userId = row.userId,
    displayName = row.displayName,
    createdAt = row.createdAt,
  )

  val alg: MembersAlg[ConnectionIO] = new MembersAlg[ConnectionIO]:
    override def list
        : ConnectionIO[List[Member]] = (selectAll ++ fr"ORDER BY id").query[MemberRow].to[List].map(
      _.map(fromRow)
    )

    override def find(id: MemberId): ConnectionIO[Option[Member]] =
      (selectAll ++ fr"WHERE id = $id").query[MemberRow].option.map(_.map(fromRow))

    override def findByDiscordUserId(userId: UserId): ConnectionIO[Option[Member]] =
      (selectAll ++ fr"WHERE user_id = $userId").query[MemberRow].option.map(_.map(fromRow))
end PostgresMembers

/** Backwards-compatible class facade. */
final class PostgresMembersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MembersRepository[F]:
  private val delegate: MembersRepository[F] = MembersRepository
    .fromAlg(PostgresMembers.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMembersRepository
