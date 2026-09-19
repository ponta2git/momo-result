package momo.api.contracts.seriesanalysis

import java.nio.file.Files

import com.networknt.schema.{InputFormat, Schema, SchemaRegistry, SpecificationVersion}
import io.circe.parser.parse
import io.circe.{Json, JsonObject}
import munit.FunSuite

import momo.api.testing.JsonSchemaAssertions

final class SeriesAnalysisResponseSchemasSpec extends FunSuite with JsonSchemaAssertions:
  private val versions = List(0, 1, 2, 3, 4, 5, 99)
  private val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)

  List(
    SeriesAnalysisResponseSchemas.aggregate -> Set(2),
    SeriesAnalysisResponseSchemas.aggregateV3 -> Set(2, 3),
    SeriesAnalysisResponseSchemas.aggregateV4 -> Set(2, 3, 4),
  ).foreach { case (resource, readable) =>
    test(s"${resource.kind} binds every aggregate payload to its artifact generation"):
      val schema = compiled(resource)
      List(3 -> 2, 4 -> 3, 5 -> 4).foreach { case (payloadVersion, artifactVersion) =>
        val payload = fixture(s"aggregate-payload-v$payloadVersion.json")
        versions.foreach { version =>
          assertResponse(schema, payload, version, readable(version) && version == artifactVersion)
        }
      }
  }

  List(
    SeriesAnalysisResponseSchemas.review -> Set(2, 3),
    SeriesAnalysisResponseSchemas.reviewV3 -> Set(2, 3, 4),
  ).foreach { case (resource, readable) =>
    test(s"${resource.kind} keeps the shared review shape within the route's generations"):
      val schema = compiled(resource)
      List(3 -> Set(2, 3), 4 -> Set(4)).foreach { case (payloadVersion, owners) =>
        val payload = fixture(s"review-payload-v$payloadVersion.json")
        versions.foreach { version =>
          assertResponse(schema, payload, version, readable(version) && owners(version))
        }
      }
  }

  test("shared drilldown shapes accept only readable artifact generations"):
    val schema = compiled(SeriesAnalysisResponseSchemas.drilldown)
    List("drilldown-payload-v3.json", "rank-signals-drilldown-payload-v3.json").foreach { name =>
      versions.foreach { version =>
        assertResponse(schema, fixture(name), version, Set(2, 3, 4)(version))
      }
    }

  test("included and excluded match contexts reject unknown artifact generations"):
    val schema = compiled(SeriesAnalysisResponseSchemas.matchContext)
    val stored = fixture("match-context-payload-v1.json")
    val included = stored.mapObject(fields =>
      fields.remove("sourceMatchRevision").add(
        "inclusion",
        Json.obj(
          "status" -> Json.fromString("included"),
          "sourceMatchRevision" ->
            fields("sourceMatchRevision").getOrElse(fail("missing revision")),
        )
      )
    )
    val excluded = Json.obj(
      "schemaVersion" -> Json.fromInt(1),
      "scope" -> Json.obj("kind" -> Json.fromString("overall")),
      "matchId" -> Json.fromString("match-1"),
      "inclusion" -> Json.obj("status" -> Json.fromString("not_in_artifact")),
      "match" -> Json.Null,
    )
    List(included, excluded).foreach { payload =>
      versions.foreach(version => assertResponse(schema, payload, version, Set(2, 3, 4)(version)))
    }

  private def compiled(resource: SeriesAnalysisResponseSchemas.Resource): Schema =
    registry.getSchema(SeriesAnalysisResponseSchemas.schemaFor(resource).noSpaces, InputFormat.JSON)

  private def assertResponse(schema: Schema, payload: Json, version: Int, valid: Boolean): Unit =
    val artifact = Json.obj(
      "artifactId" -> Json.fromString("artifact-fixture"),
      "gameTitleId" -> Json.fromString("title-fixture"),
      "inputRevision" -> Json.fromString("1"),
      "algorithmVersion" -> Json.fromString("series-analysis-v5"),
      "artifactSchemaVersion" -> Json.fromInt(version),
      "publishedAt" -> Json.fromString("2026-01-01T00:00:00Z"),
    )
    val response = hydrateMembers(payload).mapObject(fields =>
      fields.add("artifact", artifact).add(
        "scope",
        fields("scope").getOrElse(fail("missing scope"))
          .mapObject(_.add("displayName", Json.fromString("総合")))
      )
    )
    val errors = schema.validate(response.noSpaces, InputFormat.JSON)
    assertEquals(
      errors.isEmpty,
      valid,
      s"artifact $version / payload ${payload.hcursor.get[Int]("schemaVersion")}"
    )

  private def hydrateMembers(value: Json): Json = value.arrayOrObject(
    value,
    values => Json.fromValues(values.map(hydrateMembers)),
    fields =>
      val nested = JsonObject.fromIterable(fields.toIterable.map { case (key, child) =>
        key -> hydrateMembers(child)
      })
      Json.fromJsonObject(
        if nested.contains("memberId") then nested.add("displayName", Json.fromString("名前"))
        else nested
      ),
  )

  private def fixture(name: String): Json = parse(Files.readString(
    repositoryFile(s"docs/schemas/fixtures/series-analysis/$name")
  )).fold(error => fail(s"invalid fixture: $error"), identity)
