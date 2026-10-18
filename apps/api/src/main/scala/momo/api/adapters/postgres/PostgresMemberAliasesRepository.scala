package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.*

/**
 * Alias writes take a transaction-scoped advisory lock so the repository contract can keep OCR name
 * resolution unambiguous even while the DB schema still exposes only per-member uniqueness.
 */
object PostgresMemberAliases:
  private val AliasWriteLockKey = "momo:member_aliases:alias"

  private final case class MemberAliasRow(
      id: MemberAliasId,
      memberId: MemberId,
      alias: String,
      createdAt: Instant,
  )

  private def fromRow(row: MemberAliasRow): MemberAlias = MemberAlias(
    id = row.id,
    memberId = row.memberId,
    alias = row.alias,
    createdAt = row.createdAt,
  )

  def alg(using ids: PostgresIdentities): MemberAliasesAlg[ConnectionIO] =
    new MemberAliasesAlg[ConnectionIO]:
      override def list(memberId: Option[MemberId]): ConnectionIO[List[MemberAlias]] =
        val where = memberId.fold(Fragment.empty)(id =>
          fr"WHERE a.member_id = ${ids.lookup(Entity.Members, id.value)}"
        )
        val member = ids.wireReference(Entity.Members, fr"a.member_id")
        val order = fr"ORDER BY $member, a.alias, ${ids.wireId("a")}"
        val nameLimit = PostgresReadBudget.NameCodePoints
        val bounded = fr"""SELECT char_length(alias) <= $nameLimit,
        ${ids.wireId("a")}, $member, LEFT(alias, $nameLimit), created_at FROM member_aliases a"""
        PostgresReadBudget.guardedRows[MemberAliasRow](
          bounded ++ where ++ order,
          PostgresReadBudget.CatalogRows,
          "Member alias catalog"
        ).map(_.map(fromRow))

      override def find(id: MemberAliasId): ConnectionIO[Option[MemberAlias]] =
        val nameLimit = PostgresReadBudget.NameCodePoints
        PostgresReadBudget.guardedRows[MemberAliasRow](
          fr"""SELECT char_length(alias) <= $nameLimit,
          ${ids.wireId("a")}, ${ids.wireReference(Entity.Members, fr"a.member_id")},
          LEFT(alias, $nameLimit), created_at FROM member_aliases a
          WHERE a.id = ${ids.lookup(Entity.MemberAliases, id.value)}""",
          1,
          "Member alias detail",
        ).map(_.headOption.map(fromRow))

      override def create(alias: MemberAlias): ConnectionIO[Unit] = (for
        _ <- lockAliasWrites
        _ <- ensureAliasAvailable(alias.alias, excluding = None)
        identity <- ids.newId(alias.id.value)
        member <- ids.requireReference(Entity.Members, alias.memberId.value)
        _ <- sql"""
          INSERT INTO member_aliases (${ids.idColumns}, member_id, alias, created_at)
          VALUES ($identity, $member, ${alias.alias}, ${alias.createdAt})
        """.update.run.void
      yield ()).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"member alias already exists: ${alias.alias}")
      }

      override def update(alias: MemberAlias): ConnectionIO[Unit] = (for
        _ <- lockAliasWrites
        existing <- find(alias.id)
        _ <-
          existing.fold(notFound[Unit]("member alias", alias.id.value))(_ => ().pure[ConnectionIO])
        _ <- ensureAliasAvailable(alias.alias, excluding = Some(alias.id))
        member <- ids.requireReference(Entity.Members, alias.memberId.value)
        _ <- sql"""
          UPDATE member_aliases
          SET member_id = $member, alias = ${alias.alias}
          WHERE id = ${ids.lookup(Entity.MemberAliases, alias.id.value)}
        """.update.run.flatMap {
          case 1 => ().pure[ConnectionIO]
          case _ => notFound("member alias", alias.id.value)
        }
      yield ()).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"member alias already exists: ${alias.alias}")
      }

      override def delete(id: MemberAliasId): ConnectionIO[Unit] =
        sql"DELETE FROM member_aliases WHERE id = ${ids.lookup(Entity.MemberAliases, id.value)}".update.run.flatMap {
          case 1 => ().pure[ConnectionIO]
          case _ => notFound("member alias", id.value)
        }

  private def lockAliasWrites: ConnectionIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(hashtext($AliasWriteLockKey)::bigint)".query[Unit].unique

  private def ensureAliasAvailable(
      alias: String,
      excluding: Option[MemberAliasId],
  )(using ids: PostgresIdentities): ConnectionIO[Unit] =
    val excludingSelf = excluding.fold(Fragment.empty)(id =>
      fr"AND id <> ${ids.lookup(Entity.MemberAliases, id.value)}"
    )
    (fr"SELECT EXISTS(SELECT 1 FROM member_aliases WHERE alias = $alias" ++ excludingSelf ++ fr")")
      .query[Boolean].unique.flatMap {
        case false => ().pure[ConnectionIO]
        case true => conflict(s"member alias already exists: $alias")
      }
end PostgresMemberAliases

final class PostgresMemberAliasesRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends MemberAliasesRepository[F]:
  private given PostgresIdentities = identities
  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] =
    PostgresMemberAliases.alg.list(memberId).transact(transactor)

  override def find(id: MemberAliasId): F[Option[MemberAlias]] =
    PostgresMemberAliases.alg.find(id).transact(transactor)

  override def create(alias: MemberAlias): F[Either[AppError, Unit]] = RepositoryResult
    .capture(PostgresMemberAliases.alg.create(alias).transact(transactor))

  override def update(alias: MemberAlias): F[Either[AppError, Unit]] = RepositoryResult
    .capture(PostgresMemberAliases.alg.update(alias).transact(transactor))

  override def delete(id: MemberAliasId): F[Either[AppError, Unit]] = RepositoryResult
    .capture(PostgresMemberAliases.alg.delete(id).transact(transactor))
end PostgresMemberAliasesRepository
