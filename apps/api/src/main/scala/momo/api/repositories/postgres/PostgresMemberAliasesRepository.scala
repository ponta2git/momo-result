package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*
import momo.api.repositories.postgres.PostgresMeta.given

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

  private val selectAll = fr"SELECT id, member_id, alias, created_at FROM member_aliases"

  private def fromRow(row: MemberAliasRow): MemberAlias = MemberAlias(
    id = row.id,
    memberId = row.memberId,
    alias = row.alias,
    createdAt = row.createdAt,
  )

  val alg: MemberAliasesAlg[ConnectionIO] = new MemberAliasesAlg[ConnectionIO]:
    override def list(memberId: Option[MemberId]): ConnectionIO[List[MemberAlias]] =
      val where = memberId.fold(Fragment.empty)(id => fr"WHERE member_id = $id")
      val order = fr"ORDER BY member_id, alias, id"
      (selectAll ++ where ++ order).query[MemberAliasRow].to[List].map(_.map(fromRow))

    override def find(id: MemberAliasId): ConnectionIO[Option[MemberAlias]] =
      (selectAll ++ fr"WHERE id = $id").query[MemberAliasRow].option.map(_.map(fromRow))

    override def create(alias: MemberAlias): ConnectionIO[Unit] = (for
      _ <- lockAliasWrites
      _ <- ensureAliasAvailable(alias.alias, excluding = None)
      _ <- sql"""
          INSERT INTO member_aliases (id, member_id, alias, created_at)
          VALUES (${alias.id}, ${alias.memberId}, ${alias.alias}, ${alias.createdAt})
        """.update.run.void
    yield ()).exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"member alias already exists: ${alias.alias}")
    }

    override def update(alias: MemberAlias): ConnectionIO[Unit] = (for
      _ <- lockAliasWrites
      existing <- find(alias.id)
      _ <- existing.fold(notFound[Unit]("member alias", alias.id.value))(_ => ().pure[ConnectionIO])
      _ <- ensureAliasAvailable(alias.alias, excluding = Some(alias.id))
      _ <- sql"""
          UPDATE member_aliases
          SET member_id = ${alias.memberId}, alias = ${alias.alias}
          WHERE id = ${alias.id}
        """.update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("member alias", alias.id.value)
      }
    yield ()).exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"member alias already exists: ${alias.alias}")
    }

    override def delete(id: MemberAliasId): ConnectionIO[Unit] =
      sql"DELETE FROM member_aliases WHERE id = $id".update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("member alias", id.value)
      }

  private def lockAliasWrites: ConnectionIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(hashtext($AliasWriteLockKey)::bigint)".query[Unit].unique

  private def ensureAliasAvailable(
      alias: String,
      excluding: Option[MemberAliasId],
  ): ConnectionIO[Unit] =
    val excludingSelf = excluding.fold(Fragment.empty)(id => fr"AND id <> $id")
    (fr"SELECT EXISTS(SELECT 1 FROM member_aliases WHERE alias = $alias" ++ excludingSelf ++ fr")")
      .query[Boolean].unique.flatMap {
        case false => ().pure[ConnectionIO]
        case true => conflict(s"member alias already exists: $alias")
      }
end PostgresMemberAliases

final class PostgresMemberAliasesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MemberAliasesRepository[F]:
  private val transactK = Database.transactK(transactor)

  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] =
    transactK(PostgresMemberAliases.alg.list(memberId))

  override def find(id: MemberAliasId): F[Option[MemberAlias]] =
    transactK(PostgresMemberAliases.alg.find(id))

  override def create(alias: MemberAlias): F[Unit] =
    transactK(PostgresMemberAliases.alg.create(alias))

  override def update(alias: MemberAlias): F[Unit] =
    transactK(PostgresMemberAliases.alg.update(alias))

  override def delete(id: MemberAliasId): F[Unit] = transactK(PostgresMemberAliases.alg.delete(id))
end PostgresMemberAliasesRepository
