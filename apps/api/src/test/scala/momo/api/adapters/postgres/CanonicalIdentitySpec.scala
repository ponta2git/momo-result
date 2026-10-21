package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.UUID

import io.circe.parser.parse
import munit.FunSuite

import momo.api.testing.JsonSchemaAssertions

final class CanonicalIdentitySpec extends FunSuite with JsonSchemaAssertions:
  private val fixture = parse(Files.readString(repositoryFile(
    "docs/schemas/fixtures/identity/canonical-identities-v1.json"
  ))).fold(error => fail(error.toString), identity)

  test("typed canonical allocation matches every shared migration vector"):
    val cursor = fixture.hcursor
    assertEquals(cursor.get[String]("algorithm"), Right("sha256-uuidv8-v1"))
    assertEquals(cursor.get[String]("namespace"), Right(CanonicalIdentity.Namespace.toString))
    assertEquals(
      cursor.get[Vector[String]]("entityNamespaces"),
      Right(CanonicalIdentity.Entity.values.toVector.map(_.table)),
    )
    cursor.get[Vector[io.circe.Json]]("cases").fold(
      error => fail(error.toString),
      identity
    ).foreach { entry =>
      val row = entry.hcursor
      val table = row.get[String]("entity").fold(error => fail(error.toString), identity)
      val legacy = row.get[String]("legacy").fold(error => fail(error.toString), identity)
      val expected = row.get[String]("canonical").fold(error => fail(error.toString), identity)
      val entity = CanonicalIdentity.Entity.values.find(_.table == table).getOrElse(fail(table))
      assertEquals(CanonicalIdentity.structured(entity, legacy).map(_.toString), Right(expected))
    }

  test("name based SHA-256 allocation matches the independent RFC 9562 vector"):
    val vector = fixture.hcursor.downField("rfcVector")
    val namespace =
      UUID.fromString(vector.get[String]("namespace").fold(error => fail(error.toString), identity))
    val name = vector.get[String]("name").fold(error => fail(error.toString), identity)
    val expected = vector.get[String]("expected").fold(error => fail(error.toString), identity)
    assertEquals(
      CanonicalIdentity.nameBasedUuid8(namespace, name.getBytes(StandardCharsets.UTF_8)).toString,
      expected,
    )

  test("UUID spelling preserves all bits and excludes Java's short-group extension"):
    val expected = UUID.fromString("00112233-4455-6677-8899-aabbccddeeff")
    List(
      "00112233445566778899aabbccddeeff",
      "{00112233-4455-6677-8899-AABBCCDDEEFF}",
      "0011-22334455-6677-8899-aabbccddeeff",
    ).foreach(value => assertEquals(CanonicalIdentity.uuid(value), Some(expected)))
    List(
      "1-1-1-1-1",
      "00112233-4455-6677-8899-aabbccddeeff\n",
      " 00112233-4455-6677-8899-aabbccddeeff",
      "00112233-4455-6677-8899-aabbccddeeff ",
      "{00112233-4455-6677-8899-aabbccddeeff",
      "00112233-4455-6677-8899-aabbccddeeff}",
    ).foreach(value => assertEquals(CanonicalIdentity.uuid(value), None))

  test("invalid Unicode and NUL never enter a structured identity"):
    List("invalid\u0000id", "invalid\ud800", "invalid\udc00").foreach { value =>
      assert(CanonicalIdentity.structured(CanonicalIdentity.Entity.Members, value).isLeft)
    }
