package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.Decoder
import io.circe.generic.semiauto.deriveDecoder
import io.circe.parser.decode

/** Structural cutover gate. A mixture of either complete schema is never a usable mode. */
private[postgres] object PostgresIdentitySchema:
  private[postgres] final case class Column(
      table: String,
      column: String,
      dataType: String,
      notNull: Boolean,
  ) derives CanEqual
  private[postgres] final case class Key(
      table: String,
      columns: String,
      primary: Boolean,
      nullsNotDistinct: Boolean,
  ) derives CanEqual
  private[postgres] final case class ForeignKey(
      table: String,
      columns: String,
      targetTable: String,
      targetColumns: String,
      onDelete: String,
      onUpdate: String,
  ) derives CanEqual
  private[postgres] final case class RetainedCheck(table: String, name: String, expression: String)
      derives CanEqual
  private[postgres] final case class NavigationIndex(
      table: String,
      name: String,
      columns: List[String]
  ) derives CanEqual
  private[postgres] final case class PartialUniqueIndex(
      table: String,
      name: String,
      columns: List[String],
      predicate: String,
      nullsNotDistinct: Boolean,
  ) derives CanEqual
  private[postgres] final case class Shape(
      columns: List[Column],
      keys: List[Key],
      foreignKeys: List[ForeignKey],
      retainedChecks: List[RetainedCheck],
      navigationIndexes: List[NavigationIndex],
      partialUniqueIndexes: List[PartialUniqueIndex],
  )
  private final case class Contract(
      formatVersion: Int,
      optionalTables: Set[String],
      legacy: Shape,
      canonical: Shape,
  ):
    private val shapes = List(legacy, canonical)
    val checkNames: Set[String] = shapes.flatMap(_.retainedChecks.map(_.name)).toSet
    val navigationIndexNames: Set[String] = shapes.flatMap(_.navigationIndexes.map(_.name)).toSet
    val partialUniqueIndexNames: Set[String] =
      shapes.flatMap(_.partialUniqueIndexes.map(_.name)).toSet
    val indexNames: Set[String] = navigationIndexNames ++ partialUniqueIndexNames

  private given Decoder[Column] = deriveDecoder
  private given Decoder[Key] = deriveDecoder
  private given Decoder[ForeignKey] = deriveDecoder
  private given Decoder[RetainedCheck] = deriveDecoder
  private given Decoder[NavigationIndex] = deriveDecoder
  private given Decoder[PartialUniqueIndex] = deriveDecoder
  private given Decoder[Shape] = deriveDecoder
  private given Decoder[Contract] = deriveDecoder

  private lazy val loadedContract: Either[String, Contract] =
    Option(getClass.getResourceAsStream("/momo/api/identity-schema-v1.json"))
      .toRight("missing identity schema contract").flatMap { stream =>
        val json = try new String(stream.readAllBytes(), StandardCharsets.UTF_8)
        finally stream.close()
        decode[Contract](json).leftMap(_.getMessage).flatMap(parsed =>
          Either.cond(parsed.formatVersion == 1, parsed, "unsupported identity schema contract")
        )
      }

  private[postgres] def inspect: ConnectionIO[Shape] =
    for
      contract <- loadedContract.leftMap(new IllegalStateException(_)).liftTo[ConnectionIO]
      _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
      columns <- sql"""
      SELECT relation.relname::text, attribute.attname::text,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    """.query[Column].to[List]
      keys <- sql"""
      SELECT relation.relname::text,
        array_to_string(ARRAY(
          SELECT attribute.attname::text
          FROM unnest(index.indkey) WITH ORDINALITY key_column(number, position)
          JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
            AND attribute.attnum = key_column.number
          WHERE key_column.position <= index.indnkeyatts ORDER BY key_column.position
        ), ','), index.indisprimary, index.indnullsnotdistinct
      FROM pg_catalog.pg_index index
      JOIN pg_catalog.pg_class relation ON relation.oid = index.indrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND index.indisunique
        AND index.indisvalid AND index.indisready AND index.indislive AND index.indimmediate
        AND index.indpred IS NULL AND index.indexprs IS NULL
    """.query[Key].to[List]
      foreignKeys <- sql"""
      SELECT source.relname::text,
        array_to_string(ARRAY(
          SELECT attribute.attname::text
          FROM unnest(definition.conkey) WITH ORDINALITY key_column(number, position)
          JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = source.oid
            AND attribute.attnum = key_column.number ORDER BY key_column.position
        ), ','), target.relname::text,
        array_to_string(ARRAY(
          SELECT attribute.attname::text
          FROM unnest(definition.confkey) WITH ORDINALITY key_column(number, position)
          JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = target.oid
            AND attribute.attnum = key_column.number ORDER BY key_column.position
        ), ','), definition.confdeltype::text, definition.confupdtype::text
      FROM pg_catalog.pg_constraint definition
      JOIN pg_catalog.pg_class source ON source.oid = definition.conrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = source.relnamespace
      JOIN pg_catalog.pg_class target ON target.oid = definition.confrelid
      JOIN pg_catalog.pg_namespace target_namespace ON target_namespace.oid = target.relnamespace
      WHERE namespace.nspname = 'public' AND target_namespace.nspname = 'public'
        AND definition.contype = 'f' AND definition.convalidated
        AND COALESCE((to_jsonb(definition)->>'conenforced')::boolean, true)
        AND NOT definition.condeferrable AND NOT definition.condeferred
        AND definition.confmatchtype = 's' AND definition.confdelsetcols IS NULL
    """.query[ForeignKey].to[List]
      checks <- sql"""
      SELECT relation.relname::text, definition.conname::text,
             pg_catalog.pg_get_expr(definition.conbin, definition.conrelid)
      FROM pg_catalog.pg_constraint definition
      JOIN pg_catalog.pg_class relation ON relation.oid = definition.conrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND definition.contype = 'c'
        AND definition.conname::text = ANY(${contract.checkNames.toArray})
        AND definition.convalidated
        AND COALESCE((to_jsonb(definition)->>'conenforced')::boolean, true)
    """.query[RetainedCheck].to[List]
      indexes <-
        sql"""
      SELECT relation.relname::text, index_relation.relname::text,
        ARRAY(SELECT pg_catalog.pg_get_indexdef(index.indexrelid, position, true)
          || CASE WHEN index_collation.oid IS NOT NULL AND index_collation.collname <> 'default'
             THEN ' COLLATE ' || quote_ident(index_collation.collname) ELSE '' END
          || CASE WHEN (index.indoption[position - 1] & 1) <> 0 THEN ' DESC' ELSE '' END
          || CASE (index.indoption[position - 1] & 3)
             WHEN 1 THEN ' NULLS LAST' WHEN 2 THEN ' NULLS FIRST' ELSE '' END
          FROM generate_series(1, index.indnkeyatts) position
          LEFT JOIN pg_catalog.pg_collation index_collation ON index_collation.oid = index.indcollation[position - 1]
          ORDER BY position), index.indisunique, index.indnullsnotdistinct,
        pg_catalog.pg_get_expr(index.indpred, index.indrelid)
      FROM pg_catalog.pg_index index
      JOIN pg_catalog.pg_class relation ON relation.oid = index.indrelid
      JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index.indexrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND index.indisvalid AND index.indisready AND index.indislive
        AND index_relation.relname::text = ANY(${contract.indexNames.toArray})
        AND (NOT index.indisunique OR index.indimmediate)
    """.query[(String, String, Array[String], Boolean, Boolean, Option[String])].to[List]
      shape = Shape(
        columns.map(column => column.copy(dataType = normalizeType(column.dataType))),
        keys,
        foreignKeys,
        checks.map(check => check.copy(expression = normalizeCheck(check.expression))),
        indexes.collect {
          case (table, name, terms, _, _, _) if contract.navigationIndexNames.contains(name) =>
            NavigationIndex(table, name, terms.toList.map(normalizeIndex))
        },
        indexes.collect {
          case (table, name, terms, true, nullsNotDistinct, Some(predicate))
              if contract.partialUniqueIndexNames.contains(name) =>
            PartialUniqueIndex(
              table,
              name,
              terms.toList.map(term => normalizeIndex(term).replace("(", "").replace(")", "")),
              normalizeCheck(predicate),
              nullsNotDistinct,
            )
        },
      )
    yield shape

  val discover: ConnectionIO[PostgresIdentities] = inspect.flatMap(shape =>
    classify(shape).leftMap(new IllegalStateException(_)).liftTo[ConnectionIO]
  )

  private[postgres] def classify(actual: Shape): Either[String, PostgresIdentities] =
    loadedContract.flatMap { contract =>
      given Contract = contract
      if compatible(actual, contract.legacy, contract.canonical) then
        Right(PostgresIdentities.Legacy)
      else if compatible(actual, contract.canonical, contract.legacy) then
        Right(PostgresIdentities.Canonical)
      else
        Left("unsupported or partially migrated identity schema; legacy: " +
          differences(actual, contract.legacy) + "; canonical: " +
          differences(actual, contract.canonical))
    }

  private def differences(actual: Shape, expected: Shape)(using contract: Contract): String =
    val actualTables = actual.columns.map(_.table).toSet
    def applicable(table: String): Boolean = !contract.optionalTables.contains(table) ||
      actualTables.contains(table)
    val columns = expected.columns.filter(column => applicable(column.table))
    val keys = expected.keys.filter(key => applicable(key.table))
    val foreignKeys = expected.foreignKeys.filter(key => applicable(key.table))
    val checks = expected.retainedChecks.filter(check => applicable(check.table))
    val indexes = expected.navigationIndexes.filter(index => applicable(index.table))
    val partialUniqueIndexes =
      expected.partialUniqueIndexes.filter(index => applicable(index.table))
    List(
      "columns=" + columns.diff(actual.columns).take(8).mkString(","),
      "keys=" + keys.diff(actual.keys).take(8).mkString(","),
      "unexpectedSessionKeys=" + actual.keys.filter(_.table == "sessions")
        .diff(expected.keys).mkString(","),
      "foreignKeys=" + foreignKeys.diff(actual.foreignKeys).take(8).mkString(","),
      "checks=" + checks.diff(actual.retainedChecks).take(4).mkString(","),
      "indexes=" + indexes.diff(actual.navigationIndexes).take(8).mkString(","),
      "partialUniqueIndexes=" + partialUniqueIndexes.diff(actual.partialUniqueIndexes).take(4)
        .mkString(",")
    ).mkString("; ")

  private def compatible(actual: Shape, expected: Shape, other: Shape)(using
      contract: Contract): Boolean =
    val actualTables = actual.columns.map(_.table).toSet
    val expectedTables = expected.columns.map(_.table).toSet
    val otherTables = other.columns.map(_.table).toSet
    def applicable(table: String): Boolean =
      !contract.optionalTables.contains(table) || actualTables.contains(table)
    val columns = expected.columns.filter(column => applicable(column.table)).toSet
    val forbiddenTables = otherTables -- expectedTables
    val expectedForeignKeys = expected.foreignKeys.filter(key => applicable(key.table)).toSet
    forbiddenTables.intersect(actualTables).isEmpty &&
    actual.columns.filter(column => expectedTables.contains(column.table)).toSet == columns &&
    expected.keys.filter(key => applicable(key.table)).forall(actual.keys.contains) &&
    actual.keys.filter(_.table == "sessions").toSet ==
      expected.keys.filter(_.table == "sessions").toSet &&
      actual.foreignKeys.filter(key => expectedTables.contains(key.table)).toSet ==
      expectedForeignKeys &&
      expected.retainedChecks.filter(check => applicable(check.table)).forall(
        actual.retainedChecks.contains
      ) &&
      expected.navigationIndexes.filter(index => applicable(index.table)).forall(
        actual.navigationIndexes.contains
      ) &&
      expected.partialUniqueIndexes.filter(index => applicable(index.table)).forall(
        actual.partialUniqueIndexes.contains
      )

  private def normalizeType(value: String): String = value.replace("varchar", "character varying")
    .filterNot(_.isWhitespace)

  private def normalizeCheck(value: String): String = PostgresSchemaExpression.normalize(value)

  private def normalizeIndex(value: String): String = value.replace("\"", "").trim
