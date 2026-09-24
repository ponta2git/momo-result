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
    (SeriesAnalysisResponseSchemas.aggregateV4, "aggregate-payload-v5.json", List(2, 3, 4)),
    (SeriesAnalysisResponseSchemas.reviewV3, "review-payload-v4.json", List(2, 3)),
  ).foreach { case (resource, file, obsoletePayloadVersions) =>
    test(s"${resource.kind} accepts only the current artifact and payload pair"):
      val schema = compiled(resource)
      val payload = fixture(file)
      versions.foreach(version => assertResponse(schema, payload, version, version == 4))
      obsoletePayloadVersions.foreach(version =>
        assertResponse(
          schema,
          payload.mapObject(_.add("schemaVersion", Json.fromInt(version))),
          4,
          false
        )
      )
  }

  test("shared drilldown shapes accept only the current artifact generation"):
    val schema = compiled(SeriesAnalysisResponseSchemas.drilldown)
    List("drilldown-payload-v3.json", "rank-signals-drilldown-payload-v3.json").foreach { name =>
      versions.foreach(version => assertResponse(schema, fixture(name), version, version == 4))
    }

  test("included and excluded match contexts reject unknown artifact generations"):
    val schema = compiled(SeriesAnalysisResponseSchemas.matchContext)
    val stored = fixture("match-context-payload-v1.json")
    val included = stored.mapObject(fields =>
      fields.remove("sourceMatchRevision").add(
        "match",
        fields("match").getOrElse(fail("missing match"))
          .mapObject(_.add("ownerMemberId", Json.fromString("member-1"))),
      ).add(
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
    val missingOwner = included.mapObject(fields =>
      fields.add(
        "match",
        fields("match").get.mapObject(_.remove("ownerMemberId"))
      )
    )
    assertResponse(schema, missingOwner, 4, false)
    val extraOwnerOnExcluded =
      excluded.mapObject(_.add("ownerMemberId", Json.fromString("member-1")))
    assertResponse(schema, extraOwnerOnExcluded, 4, false)
    List(included, excluded).foreach { payload =>
      versions.foreach(version => assertResponse(schema, payload, version, version == 4))
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
