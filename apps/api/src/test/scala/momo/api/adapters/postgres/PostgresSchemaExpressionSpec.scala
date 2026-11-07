package momo.api.adapters.postgres

final class PostgresSchemaExpressionSpec extends munit.FunSuite:
  test("PostgreSQL casts and redundant parentheses preserve the grouped attendance predicate"):
    val declared =
      "occupies_date OR (source = 'legacy' AND status = 'SKIPPED')"
    val postgres =
      "(occupies_date OR ((source = 'legacy'::text) AND (status = 'SKIPPED'::text)))"
    assertEquals(
      PostgresSchemaExpression.normalize(declared),
      "OR(occupies_date,AND(source='legacy',status='SKIPPED'))"
    )
    assertEquals(
      PostgresSchemaExpression.normalize(postgres),
      PostgresSchemaExpression.normalize(declared)
    )
    assertNotEquals(
      PostgresSchemaExpression.normalize(
        "(occupies_date OR source = 'legacy') AND status = 'SKIPPED'"
      ),
      PostgresSchemaExpression.normalize(declared)
    )

  test("IN and PostgreSQL ANY use the same bounded literal set"):
    assertEquals(
      PostgresSchemaExpression.normalize("source IN ('manual','weekly_auto')"),
      PostgresSchemaExpression.normalize(
        "(source = ANY (ARRAY['manual'::text, 'weekly_auto'::text]))"
      )
    )

  test("boolean words inside quoted values are not operators"):
    assertEquals(PostgresSchemaExpression.normalize("value = 'OR'"), "value='OR'")

  test("retained nullable aliases keep their equality expression"):
    assertEquals(
      PostgresSchemaExpression.normalize("((member_id IS NULL) = (legacy_member_id IS NULL))"),
      "member_idISNULL=legacy_member_idISNULL"
    )

  test("literal content cannot turn a different CHECK or partial predicate into the required one"):
    val expected = PostgresSchemaExpression.normalize("source = 'weekly_auto'")
    List("week ly_auto", "(weekly_auto)", "weekly_auto::text").foreach { literal =>
      assertNotEquals(PostgresSchemaExpression.normalize(s"source = '$literal'"), expected)
    }
    assertEquals(
      PostgresSchemaExpression.normalize("value = 'x OR (y) AND z::text'' $1 \\ end'::text"),
      "value='x OR (y) AND z::text'' $1 \\ end'"
    )

  test("mixed operators retain SQL precedence"):
    assertEquals(
      PostgresSchemaExpression.normalize("a OR b AND c OR d AND e"),
      "OR(a,AND(b,c),AND(d,e))"
    )
