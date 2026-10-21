package momo.api.adapters.postgres

import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.errors.{AppError, AppException}

/** One startup-validated storage mode. Domain, principal and calculation identities stay legacy. */
enum PostgresIdentities derives CanEqual:
  case Legacy, Canonical

  private[postgres] def wireId(alias: String): Fragment =
    Fragment.const(s"$alias.${if this == Canonical then "legacy_id" else "id"}")

  private[postgres] def idColumns: Fragment = this match
    case Legacy => fr"id"
    case Canonical => fr"id, legacy_id"

  private[api] def accountReference(raw: String): Fragment = lookup(Entity.Accounts, raw)

  /** Resolve exact legacy identity first, then a canonical UUID, under the caller's SQL scope. */
  private[postgres] def lookup(entity: Entity, raw: String): Fragment = this match
    case Legacy => fr"$raw"
    case Canonical =>
      val table = Fragment.const(entity.identityTable)
      val parsed = CanonicalIdentity.uuid(raw)
      fr"""(SELECT identity.id FROM $table identity
        WHERE identity.legacy_id = $raw OR identity.id = $parsed
        ORDER BY (identity.legacy_id = $raw) DESC LIMIT 1)"""

  private[postgres] def lookup(entity: Entity, raw: Option[String]): Fragment = raw match
    case Some(value) => lookup(entity, value)
    case None => this match
        case Legacy => fr"NULL::text"
        case Canonical => fr"NULL::uuid"

  private[postgres] def lookupArray(entity: Entity, values: List[String]): Fragment = this match
    case Legacy => fr"${values.toArray}"
    case Canonical =>
      fr"ARRAY[" ++ values.map(lookup(entity, _)).intercalate(fr",") ++ fr"]::uuid[]"

  /** Resolve a bounded batch before a native UUID batch INSERT; no per-row transactions. */
  private[postgres] def requireUuidReferences(
      entity: Entity,
      values: List[String],
  ): ConnectionIO[Map[String, UUID]] =
    val selections = values.distinct.map(raw => fr"SELECT $raw, ${lookup(entity, raw)}")
    if selections.isEmpty then Map.empty[String, UUID].pure[ConnectionIO]
    else
      selections.intercalate(fr"UNION ALL").query[(String, Option[UUID])].to[List].flatMap {
        _.traverse {
          case (raw, Some(id)) => (raw -> id).pure[ConnectionIO]
          case (raw, None) => new AppException(AppError.NotFound(entity.table, raw))
              .raiseError[ConnectionIO, (String, UUID)]
        }.map(_.toMap)
      }

  /** A missing non-null mutation reference must fail, never become a nullable foreign key. */
  private[postgres] def requireReference(entity: Entity, raw: String): ConnectionIO[Fragment] =
    this match
      case Legacy => fr"$raw".pure[ConnectionIO]
      case Canonical => sql"SELECT ${lookup(entity, raw)}".query[Option[UUID]].unique.flatMap {
          case Some(id) => fr"$id".pure[ConnectionIO]
          case None => new AppException(AppError.NotFound(entity.table, raw))
              .raiseError[ConnectionIO, Fragment]
        }

  private[postgres] def requireReference(
      entity: Entity,
      raw: Option[String]
  ): ConnectionIO[Fragment] = raw match
    case Some(value) => requireReference(entity, value)
    case None => (if this == Canonical then fr"NULL::uuid" else fr"NULL::text").pure[ConnectionIO]

  /** Read a declared FK back through its parent identity; SQL joins still use native UUIDs. */
  private[postgres] def wireReference(entity: Entity, column: Fragment): Fragment = this match
    case Legacy => column
    case Canonical =>
      val table = Fragment.const(entity.identityTable)
      fr"(SELECT identity.legacy_id FROM $table identity WHERE identity.id = $column)"

  /** Resolve aliases after the HTTP request hash, preserving unknown input for normal validation. */
  private[postgres] def normalize(entity: Entity, raw: String): ConnectionIO[String] = this match
    case Legacy => raw.pure[ConnectionIO]
    case Canonical => sql"SELECT COALESCE(${wireReference(entity, lookup(entity, raw))}, $raw)"
        .query[String].unique

  private[postgres] def normalize(
      entity: Entity,
      raw: Option[String]
  ): ConnectionIO[Option[String]] =
    raw.traverse(normalize(entity, _))

  /** Retained references have no live-parent FK and must outlive parent cleanup. */
  private[postgres] def retainedColumn(alias: String, column: String): Fragment =
    val name = if this == Canonical then s"legacy_$column" else column
    Fragment.const(s"$alias.$name")

  private[postgres] def retainedMatches(alias: String, column: String, raw: String): Fragment =
    this match
      case Legacy => Fragment.const(s"$alias.$column") ++ fr"= $raw"
      case Canonical =>
        val native = Fragment.const(s"$alias.$column")
        val legacy = retainedColumn(alias, column)
        val parsed = CanonicalIdentity.uuid(raw)
        fr"($legacy = $raw OR $native = $parsed)"

  private[postgres] def retainedIn(alias: String, column: String, values: List[String]): Fragment =
    val raw = values.toArray
    val native = Fragment.const(s"$alias.$column")
    this match
      case Legacy => fr"$native = ANY($raw)"
      case Canonical =>
        val parsed = values.flatMap(CanonicalIdentity.uuid).toArray
        val legacy = retainedColumn(alias, column)
        fr"($legacy = ANY($raw) OR $native = ANY($parsed))"

  private[postgres] def legacyColumn(column: String): Fragment = this match
    case Legacy => Fragment.empty
    case Canonical => Fragment.const(s", legacy_$column")

  private[postgres] def legacyValue(value: String): Fragment = this match
    case Legacy => Fragment.empty
    case Canonical => fr", $value"

  private[postgres] def legacyValue(value: Option[String]): Fragment = this match
    case Legacy => Fragment.empty
    case Canonical => fr", $value"

  private[postgres] def legacyValue(value: Fragment): Fragment = this match
    case Legacy => Fragment.empty
    case Canonical => fr"," ++ value

  private[postgres] def legacySet(column: String, value: Fragment): Fragment = this match
    case Legacy => Fragment.empty
    case Canonical => Fragment.const(s", legacy_$column = ") ++ value

  /** Ordinary new entities accept the UUID allocated once by their caller. */
  private[postgres] def newId(raw: String): ConnectionIO[Fragment] = this match
    case Legacy => fr"$raw".pure[ConnectionIO]
    case Canonical => CanonicalIdentity.uuid(raw) match
        case Some(id) => fr"$id, ${id.toString}".pure[ConnectionIO]
        case None => new AppException(AppError.ValidationFailed("A new entity ID must be a UUID."))
            .raiseError[ConnectionIO, Fragment]

  /** Only trusted structured allocations and retained identities use the frozen typed mapping. */
  private[postgres] def retainedValue(entity: Entity, legacy: String): ConnectionIO[Fragment] =
    this match
      case Legacy => fr"$legacy".pure[ConnectionIO]
      case Canonical => CanonicalIdentity.structured(entity, legacy)
          .leftMap(reason => new IllegalArgumentException(reason)).liftTo[ConnectionIO]
          .map(id => fr"$id")

  private[postgres] def retainedValue(
      entity: Entity,
      legacy: Option[String]
  ): ConnectionIO[Fragment] = legacy match
    case Some(value) => retainedValue(entity, value)
    case None => (if this == Canonical then fr"NULL::uuid" else fr"NULL::text").pure[ConnectionIO]

  private[postgres] def structuredId(entity: Entity, legacy: String): ConnectionIO[Fragment] =
    retainedValue(entity, legacy).map(_ ++ legacyValue(legacy))

object PostgresIdentities:
  val discover: ConnectionIO[PostgresIdentities] = PostgresIdentitySchema.discover
