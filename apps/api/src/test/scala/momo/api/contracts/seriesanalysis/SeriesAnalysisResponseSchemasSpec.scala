package momo.api.contracts.seriesanalysis

import java.nio.file.Files

import com.networknt.schema.{InputFormat, Schema, SchemaRegistry, SpecificationVersion}
import io.circe.parser.parse
import io.circe.{Json, JsonObject}
import munit.FunSuite

import momo.api.testing.JsonSchemaAssertions

final class SeriesAnalysisResponseSchemasSpec extends FunSuite with JsonSchemaAssertions:
  private val versions = List(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 99)
  private val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)

  List(
    (SeriesAnalysisResponseSchemas.aggregateV5, "aggregate-payload-v7.json", List(2, 3, 4, 5, 6)),
    (SeriesAnalysisResponseSchemas.reviewV3, "review-payload-v4.json", List(2, 3)),
  ).foreach { case (resource, file, obsoletePayloadVersions) =>
    test(s"${resource.kind} accepts only the current artifact and payload pair"):
      val schema = compiled(resource)
      val payload = fixture(file)
      versions.foreach(version => assertResponse(schema, payload, version, version == 11))
      obsoletePayloadVersions.foreach(version =>
        assertResponse(
          schema,
          payload.mapObject(_.add("schemaVersion", Json.fromInt(version))),
          11,
          false
        )
      )
  }

  test("shared drilldown shapes accept only the current artifact generation"):
    val schema = compiled(SeriesAnalysisResponseSchemas.drilldown)
    List(fixture("drilldown-payload-v4.json"), evidenceWithNotes).foreach { payload =>
      versions.foreach(version => assertResponse(schema, payload, version, version == 11))
    }

  test("evidence rows require the API-attached note and bound its length"):
    val schema = compiled(SeriesAnalysisResponseSchemas.drilldown)
    assertResponse(schema, evidenceWithNotes, 11, true)
    assertResponse(
      schema,
      fixture("expected-rank-gap-evidence-drilldown-payload-v4.json"),
      11,
      false
    )
    assertResponse(schema, evidenceWith(Json.fromString("あ" * 151)), 11, false)

  private def evidenceWith(note: Json): Json =
    val stored = fixture("expected-rank-gap-evidence-drilldown-payload-v4.json")
    stored.hcursor.downField("payload").withFocus(_.mapObject(detail =>
      List("above", "below").foldLeft(detail)((fields, side) =>
        fields.add(
          side,
          Json.fromValues(fields(side).flatMap(_.asArray).getOrElse(Vector.empty).map(
            _.mapObject(_.add("note", note))
          )),
        )
      )
    )).top.getOrElse(fail("evidence fixture has no payload"))

  private def evidenceWithNotes: Json = evidenceWith(Json.Null)

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
    assertResponse(schema, missingOwner, 11, false)
    val extraOwnerOnExcluded =
      excluded.mapObject(_.add("ownerMemberId", Json.fromString("member-1")))
    assertResponse(schema, extraOwnerOnExcluded, 11, false)
    List(included, excluded).foreach { payload =>
      versions.foreach(version => assertResponse(schema, payload, version, version == 11))
    }

  private def compiled(resource: SeriesAnalysisResponseSchemas.Resource): Schema =
    registry.getSchema(SeriesAnalysisResponseSchemas.schemaFor(resource).noSpaces, InputFormat.JSON)

  private def assertResponse(schema: Schema, payload: Json, version: Int, valid: Boolean): Unit =
    val artifact = Json.obj(
      "artifactId" -> Json.fromString("artifact-fixture"),
      "gameTitleId" -> Json.fromString("title-fixture"),
      "inputRevision" -> Json.fromString("1"),
      "algorithmVersion" -> Json.fromString("series-analysis-v15"),
      "artifactSchemaVersion" -> Json.fromInt(version),
      "publishedAt" -> Json.fromString("2026-01-01T00:00:00Z"),
      "radarBasisCreatedAt" -> Json.Null,
      "radarBasisAppliedAt" -> Json.Null,
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
