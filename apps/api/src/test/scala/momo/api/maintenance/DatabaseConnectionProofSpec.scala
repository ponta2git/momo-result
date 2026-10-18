package momo.api.maintenance

import munit.FunSuite

final class DatabaseConnectionProofSpec extends FunSuite:
  private val ledger = List(
    DatabaseConnectionProof.LedgerRow("a" * 64, "1730000000000"),
    DatabaseConnectionProof.LedgerRow("b" * 64, "1730000000001"),
  )
  private val configured = "postgresql://role:secret@ep-fixture.example.neon.tech/configured"

  private def proof(): DatabaseConnectionProof = proof(configured, "actual")

  private def proof(url: String): DatabaseConnectionProof = proof(url, "actual")

  private def proof(url: String, database: String): DatabaseConnectionProof =
    DatabaseConnectionProof.fromSnapshot(url, database, ledger).fold(
      error => fail(error.getMessage),
      identity
    )

  test("matches the shared proof vector using the actual database and ordered full ledger"):
    val result = proof()
    assertEquals(
      result.targetFingerprint,
      "6771b0dca574fd57070c4e09362db28a2603f50c6a31c7ace1690390a4fa7169"
    )
    assertEquals(
      result.ledgerFingerprint,
      "6c999946c7604635b2672944e5bd546152a17281205cfb4429ed3df8d20cd5ab"
    )
    assert(!result.toJson.noSpaces.contains("role"))
    assert(!result.toJson.noSpaces.contains("secret"))
    assert(!result.toJson.noSpaces.contains("actual"))
    assertNotEquals(proof(configured, "configured"), result)
    val reversed = DatabaseConnectionProof.fromSnapshot(configured, "actual", ledger.reverse)
    assertNotEquals(reversed.toOption.map(_.ledgerFingerprint), Some(result.ledgerFingerprint))

  test(
    "normalizes case, default port and Neon pooler host without binding credentials or URL path"
  ):
    List(
      "postgres://other:different@EP-FIXTURE.EXAMPLE.NEON.TECH:5432/ignored",
      "postgresql://ep-fixture-pooler.example.neon.tech/ignored",
      "jdbc:postgresql://ep-fixture.example.neon.tech/ignored?user=other&password=different",
    ).foreach(url => assertEquals(proof(url), proof()))
    assertNotEquals(proof("postgresql://ep-fixture.example.neon.tech:5433/ignored"), proof())
    assertNotEquals(
      proof("postgresql://ep-fixture-pooler.example.com/ignored"),
      proof("postgresql://ep-fixture.example.com/ignored"),
    )

  test("rejects empty, malformed and noncanonical ledger rows without including raw values"):
    List(
      Nil,
      List(DatabaseConnectionProof.LedgerRow("A" * 64, "1730000000000")),
      List(DatabaseConnectionProof.LedgerRow("connection-and-row-secret", "1")),
      List(DatabaseConnectionProof.LedgerRow("a" * 64, "-1")),
      List(DatabaseConnectionProof.LedgerRow("a" * 64, "1.0")),
    ).foreach { rows =>
      val result = DatabaseConnectionProof.fromSnapshot(configured, "actual", rows)
      assert(result.isLeft)
      assertEquals(result.swap.toOption.map(_.getMessage), Some("Invalid database proof ledger."))
    }

  test("rejects unidentifiable configured targets and missing actual database"):
    List(
      "invalid-secret",
      "file:///fixture",
      "postgresql://host:0/db",
      "jdbc:postgresql://one,two/db"
    )
      .foreach { url =>
        val result = DatabaseConnectionProof.fromSnapshot(url, "actual", ledger)
        assert(result.isLeft)
        assertEquals(
          result.swap.toOption.map(_.getMessage),
          Some("Invalid database proof configuration.")
        )
      }
    assert(DatabaseConnectionProof.fromSnapshot(configured, "", ledger).isLeft)
