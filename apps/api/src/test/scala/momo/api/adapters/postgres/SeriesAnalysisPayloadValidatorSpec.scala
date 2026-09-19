package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.Files

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.domain.ids.{GameTitleId, MatchId, MemberId, SeasonMasterId}
import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisScope
}
import momo.api.testing.JsonSchemaAssertions

final class SeriesAnalysisPayloadValidatorSpec extends FunSuite with JsonSchemaAssertions:
  private val titleId = GameTitleId.unsafeFromString("title-payload-validator")
  private val overall = SeriesAnalysisScope.Overall

  test("accepts the Rust-attested owner resource fixtures"):
    assert(validate(
      sharedFixture("aggregate-payload-v3.json"),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate),
      None,
    ))
    assert(validate(
      sharedFixture("review-payload-v3.json"),
      simpleRequest(SeriesAnalysisChunkKind.Review),
      None,
    ))
    assert(validate(
      sharedFixture("drilldown-payload-v3.json"),
      request(
        SeriesAnalysisChunkKind.Drilldown,
        Some("member-1"),
        Some(SeriesAnalysisDrilldownMetric.RankAverageHistory),
        None,
      ),
      None,
    ))
    assert(validate(
      sharedFixture("rank-signals-drilldown-payload-v3.json"),
      request(
        SeriesAnalysisChunkKind.Drilldown,
        Some("member-1"),
        Some(SeriesAnalysisDrilldownMetric.RankSignals),
        None,
      ),
      None,
    ))
    assert(validate(
      sharedFixture("match-context-payload-v1.json"),
      request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
      Some(1),
    ))

  test("selects aggregate shape by the attested generation, rejecting crossed payloads"):
    val old = sharedFixture("aggregate-payload-v3.json")
    val current = sharedFixture("aggregate-payload-v4.json")
    val request = simpleRequest(SeriesAnalysisChunkKind.Aggregate)
    assert(validate(current, request, None, 3))
    assert(!validate(old, request, None, 3))
    assert(!validate(current, request, None, 2))
    assert(!validate(current, request, None, 99))
    assert(!validate(current.mapObject(_.remove("ownerComparison")), request, None, 3))
    SeriesAnalysisArtifactSupport.ReadableContracts.foreach { case (version, id) =>
      assert(SeriesAnalysisArtifactSupport.supports(version, Some(id)))
      assert(!SeriesAnalysisArtifactSupport.supports(version, None))
      SeriesAnalysisArtifactSupport.ReadableContracts.filterNot(_._1 == version).foreach {
        case (_, otherId) => assert(!SeriesAnalysisArtifactSupport.supports(version, Some(otherId)))
      }
    }

  test("presentation-free artifacts require their exact publication generation"):
    List(
      (SeriesAnalysisChunkKind.Aggregate, "aggregate-payload-v5.json", "aggregate-payload-v4.json"),
      (SeriesAnalysisChunkKind.Review, "review-payload-v4.json", "review-payload-v3.json"),
    ).foreach { case (kind, currentFile, previousFile) =>
      val current = sharedFixture(currentFile)
      val request = simpleRequest(kind)
      assert(validate(current, request, None, 4))
      assert(!validate(current, request, None, 3))
      assert(!validate(sharedFixture(previousFile), request, None, 4))
    }

  test("keeps the API drilldown vocabulary aligned with the owner schema"):
    val schema = sharedSchema("series-analysis-drilldown-v3.schema.json")
    val metricIds = schema.hcursor.downField("oneOf").as[Vector[Json]]
      .fold(error => fail(s"invalid drilldown schema branches: $error"), identity)
      .map(branch =>
        branch.hcursor.get[String]("x-momo-metricId")
          .fold(error => fail(s"invalid drilldown metric annotation: $error"), identity)
      )
      .toSet

    assertEquals(metricIds, SeriesAnalysisDrilldownMetric.supportedIds.toSet)

  test("rejects generated-shape and request-identity mismatches"):
    assert(!validate(
      sharedFixture("aggregate-payload-v3.json").mapObject(_.add("unexpected", Json.True)),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate),
      None,
    ))
    assert(!validate(
      sharedFixture("aggregate-payload-v3.json"),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate).copy(
        scope = SeriesAnalysisScope.Season(
          SeasonMasterId.unsafeFromString("season-other")
        )
      ),
      None,
    ))
    assert(!validate(
      sharedFixture("drilldown-payload-v3.json"),
      request(
        SeriesAnalysisChunkKind.Drilldown,
        Some("member-other"),
        Some(SeriesAnalysisDrilldownMetric.RankAverageHistory),
        None,
      ),
      None,
    ))
    assert(!validate(
      sharedFixture("drilldown-payload-v3.json"),
      request(
        SeriesAnalysisChunkKind.Drilldown,
        Some("member-1"),
        Some(SeriesAnalysisDrilldownMetric.UnexpectedWins),
        None,
      ),
      None,
    ))
    assert(!validate(
      sharedFixture("match-context-payload-v1.json"),
      request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-other")),
      Some(1),
    ))
    assert(!validate(
      sharedFixture("match-context-payload-v1.json"),
      request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
      Some(2),
    ))

  test("rejects nested shape violations and unsigned-field underflow"):
    val aggregate = sharedFixture("aggregate-payload-v3.json")
    val emptySummary = aggregate.hcursor.downField("summary")
      .withFocus(_ => Json.obj()).top.getOrElse(fail("failed to replace aggregate summary"))
    val negativeCount = aggregate.hcursor.downField("summary").downField("totalGinjiCount")
      .withFocus(_ => Json.fromLong(-1)).top
      .getOrElse(fail("failed to replace aggregate totalGinjiCount"))

    List(emptySummary, negativeCount).foreach(invalid =>
      assert(!validate(invalid, simpleRequest(SeriesAnalysisChunkKind.Aggregate), None))
    )

  test("derives and enforces the Rust owner's UTF-8 byte bound"):
    val oversized = sharedFixture("aggregate-payload-v3.json").hcursor
      .downField("source").downField("gameTitleId")
      .withFocus(_ => Json.fromString("あ" * 1400)).top
      .getOrElse(fail("failed to replace aggregate source gameTitleId"))

    assert(!validate(oversized, simpleRequest(SeriesAnalysisChunkKind.Aggregate), None))

  test("does not recalculate producer semantics after exact publication attestation"):
    val semanticallyInvalid = sharedFixture("review-payload-v3.json").hcursor
      .downField("playbookByPlayer").downArray.downField("primaryCard").downField("targetCount")
      .withFocus(_ => Json.fromInt(2)).top
      .getOrElse(fail("failed to replace review targetCount"))

    assert(validate(
      semanticallyInvalid,
      simpleRequest(SeriesAnalysisChunkKind.Review),
      None,
    ))

  private def request(
      kind: SeriesAnalysisChunkKind,
      memberId: Option[String],
      metric: Option[SeriesAnalysisDrilldownMetric],
      matchId: Option[String],
  ): SeriesAnalysisChunkRequest = SeriesAnalysisChunkRequest(
    kind,
    titleId,
    "artifact-payload-validator",
    overall,
    memberId.map(MemberId.unsafeFromString),
    metric,
    matchId.map(MatchId.unsafeFromString),
  )

  private def simpleRequest(kind: SeriesAnalysisChunkKind): SeriesAnalysisChunkRequest =
    request(kind, None, None, None)

  private def sharedFixture(name: String): Json =
    parse(Files.readString(repositoryFile(s"docs/schemas/fixtures/series-analysis/$name")))
      .fold(error => fail(s"invalid shared fixture: $error"), identity)

  private def validate(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      revision: Option[Long]
  ): Boolean =
    validate(json, request, revision, 2)

  private def validate(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      revision: Option[Long],
      artifactSchemaVersion: Int,
  ): Boolean = SeriesAnalysisPayloadValidator.validate(
    json,
    json.noSpaces.getBytes(StandardCharsets.UTF_8),
    request,
    revision,
    artifactSchemaVersion,
  )

  private def sharedSchema(fileName: String): Json =
    parse(Files.readString(repositoryFile(s"docs/schemas/$fileName")))
      .fold(error => fail(s"invalid shared schema $fileName: $error"), identity)
end SeriesAnalysisPayloadValidatorSpec
