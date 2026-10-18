package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.PublicId
import momo.api.domain.ids.{HeldEventId, MatchId}

/** Validated once during startup; independent of any canonical UUID identity migration. */
enum PostgresPublicIds derives CanEqual:
  case Legacy, Available

  private[postgres] def column(available: Fragment): Fragment = this match
    case Legacy => fr"NULL::bigint"
    case Available => available

  private[postgres] def matchId(publicId: PublicId)(using
      ids: PostgresIdentities): ConnectionIO[Option[MatchId]] = this match
    case Legacy => none[MatchId].pure[ConnectionIO]
    case Available =>
      sql"SELECT ${ids.wireId("matches")} FROM matches WHERE public_id = $publicId".query[MatchId].option

  private[postgres] def heldEventId(publicId: PublicId)(using
      ids: PostgresIdentities): ConnectionIO[Option[HeldEventId]] =
    this match
      case Legacy => none[HeldEventId].pure[ConnectionIO]
      case Available =>
        sql"SELECT ${ids.wireId("held_events")} FROM held_events WHERE public_id = $publicId".query[
          HeldEventId
        ].option

object PostgresPublicIds:
  private final case class Shape(tableExists: Boolean, columnExists: Boolean, valid: Boolean)

  val discover: ConnectionIO[PostgresPublicIds] = sql"""
    SELECT relation.oid IS NOT NULL, attribute.attnum IS NOT NULL,
      COALESCE(attribute.atttypid = 'pg_catalog.int8'::regtype
        AND attribute.attnotnull AND attribute.attidentity = 'a'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_index index
          WHERE index.indrelid = relation.oid AND index.indisunique
            AND index.indisvalid AND index.indisready AND index.indnkeyatts = 1
            AND index.indkey[0] = attribute.attnum
            AND index.indpred IS NULL AND index.indexprs IS NULL
        ), false)
    FROM (VALUES ('held_events'), ('matches')) expected(name)
    LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class relation ON relation.relnamespace = namespace.oid
      AND relation.relname = expected.name AND relation.relkind IN ('r','p')
    LEFT JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
      AND attribute.attname = 'public_id' AND attribute.attnum > 0 AND NOT attribute.attisdropped
  """.query[Shape].to[List].flatMap { rows =>
    if rows.size == 2 && rows.forall(row => row.tableExists && !row.columnExists) then
      PostgresPublicIds.Legacy.pure[ConnectionIO]
    else if rows.size == 2 && rows.forall(_.valid) then
      PostgresPublicIds.Available.pure[ConnectionIO]
    else
      new IllegalStateException("unsupported public identifier schema")
        .raiseError[ConnectionIO, PostgresPublicIds]
  }
