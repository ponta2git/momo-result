package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.Member
import momo.api.domain.ids.{MemberId, UserId}
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

end PostgresMembers

final class PostgresMembersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MembersRepository[F]:
  private val delegate: MembersRepository[F] = MembersRepository
    .fromAlg(PostgresMembers.alg, transactor.trans)

  export delegate.*
end PostgresMembersRepository
