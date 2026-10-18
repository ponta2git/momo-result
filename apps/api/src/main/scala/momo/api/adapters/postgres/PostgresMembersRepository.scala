package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
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

  private def selectAll(using ids: PostgresIdentities) =
    fr"SELECT ${ids.wireId("m")}, m.user_id, m.display_name, m.created_at FROM members m"

  private def fromRow(row: MemberRow): Member = Member(
    id = row.id,
    userId = row.userId,
    displayName = row.displayName,
    createdAt = row.createdAt,
  )

  def alg(using ids: PostgresIdentities): MembersAlg[ConnectionIO] =
    new MembersAlg[ConnectionIO]:
      override def list: ConnectionIO[List[Member]] =
        // The schema bounds display_name to varchar(32); only collection size needs a read budget.
        PostgresReadBudget.rows[MemberRow](
          selectAll ++ fr"ORDER BY ${ids.wireId("m")}",
          PostgresReadBudget.CatalogRows,
          "Member catalog"
        ).map(_.map(fromRow))

      override def find(id: MemberId): ConnectionIO[Option[Member]] =
        (selectAll ++ fr"WHERE m.id = ${ids.lookup(Entity.Members, id.value)}").query[
          MemberRow
        ].option.map(_.map(fromRow))

end PostgresMembers

final class PostgresMembersRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends MembersRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: MembersRepository[F] = MembersRepository
    .fromAlg(PostgresMembers.alg, transactor.trans)

  export delegate.*
end PostgresMembersRepository
