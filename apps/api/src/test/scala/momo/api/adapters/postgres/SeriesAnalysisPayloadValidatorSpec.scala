package momo.api.adapters.postgres

import java.nio.file.Files

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.domain.ids.{GameTitleId, MatchId, MemberId}
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

  test("accepts the four shared owner resource fixtures"):
    assertEquals(
      validate(
        sharedFixture("aggregate-payload-v3.json"),
        simpleRequest(SeriesAnalysisChunkKind.Aggregate),
        0,
        None,
      ),
      true,
    )

    assertEquals(
      validate(
        sharedFixture("review-payload-v3.json"),
        simpleRequest(SeriesAnalysisChunkKind.Review),
        1,
        None,
      ),
      true,
    )
    assertEquals(
      validate(
        sharedFixture("drilldown-payload-v3.json"),
        request(
          SeriesAnalysisChunkKind.Drilldown,
          Some("member-1"),
          Some(SeriesAnalysisDrilldownMetric.RankAverageHistory),
          None,
        ),
        1,
        None,
      ),
      true,
    )
    assertEquals(
      validate(
        sharedFixture("match-context-payload-v1.json"),
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(1),
      ),
      true,
    )

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

  test("rejects unknown fields and manifest identity mismatches"):
    assertEquals(
      validate(
        sharedFixture("aggregate-payload-v3.json").mapObject(_.add("unexpected", Json.True)),
        simpleRequest(SeriesAnalysisChunkKind.Aggregate),
        0,
        None,
      ),
      false,
    )
    assertEquals(
      validate(
        sharedFixture("drilldown-payload-v3.json"),
        request(
          SeriesAnalysisChunkKind.Drilldown,
          Some("member-other"),
          Some(SeriesAnalysisDrilldownMetric.RankAverageHistory),
          None,
        ),
        1,
        None,
      ),
      false,
    )
    assertEquals(
      validate(
        sharedFixture("match-context-payload-v1.json"),
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(2),
      ),
      false,
    )

  test("rejects nested empty shapes and unknown nested fields"):
    val aggregate = sharedFixture("aggregate-payload-v3.json")
    val emptyObject = aggregate.hcursor
      .downField("summary")
      .withFocus(_ => Json.obj())
      .top
      .getOrElse(fail("failed to replace aggregate summary"))
    val emptyArray = aggregate.hcursor
      .downField("strategyScatter")
      .withFocus(_ => Json.arr())
      .top
      .getOrElse(fail("failed to replace aggregate strategyScatter"))
    val unknownNested = aggregate.hcursor
      .downField("source")
      .withFocus(_.mapObject(_.add("unexpected", Json.True)))
      .top
      .getOrElse(fail("failed to add nested aggregate field"))

    List(emptyObject, emptyArray, unknownNested).foreach { invalid =>
      assertEquals(
        validate(invalid, simpleRequest(SeriesAnalysisChunkKind.Aggregate), 0, None),
        false,
      )
    }

  test("rejects a drilldown resource from a different metric branch"):
    val invalid = sharedFixture("drilldown-payload-v3.json").hcursor
      .downField("payload")
      .downField("kind")
      .withFocus(_ => Json.fromString("unexpected_wins"))
      .top
      .getOrElse(fail("failed to replace drilldown payload kind"))

    assertEquals(
      validate(
        invalid,
        request(
          SeriesAnalysisChunkKind.Drilldown,
          Some("member-1"),
          Some(SeriesAnalysisDrilldownMetric.UnexpectedWins),
          None,
        ),
        1,
        None,
      ),
      false,
    )

  test("rejects a negative value in an unsigned schema field"):
    val invalid = sharedFixture("aggregate-payload-v3.json").hcursor
      .downField("summary")
      .downField("totalGinjiCount")
      .withFocus(_ => Json.fromLong(-1))
      .top
      .getOrElse(fail("failed to replace aggregate totalGinjiCount"))

    assertEquals(
      validate(invalid, simpleRequest(SeriesAnalysisChunkKind.Aggregate), 0, None),
      false,
    )

  test("enforces the Rust owner's UTF-8 byte bound instead of a character-count approximation"):
    val oversized = sharedFixture("aggregate-payload-v3.json").hcursor
      .downField("source")
      .downField("gameTitleId")
      .withFocus(_ => Json.fromString("あ" * 1400))
      .top.getOrElse(fail("failed to replace aggregate source gameTitleId"))

    assertEquals(
      validate(oversized, simpleRequest(SeriesAnalysisChunkKind.Aggregate), 0, None),
      false,
    )

  test("rejects match-number rows that can misalign Web matrix labels and values"):
    val aggregate = sharedFixture("aggregate-payload-v3.json")
    def withEntries(entries: Json*): Json = aggregate.hcursor
      .downField("matchNoInEvent")
      .withFocus(_.mapObject(_.add("entries", Json.arr(entries*))))
      .top.getOrElse(fail("failed to replace match-number entries"))
    def entry(number: Int, category: String, players: Json*): Json = Json.obj(
      "category" -> Json.fromString(category),
      "matchNoInEvent" -> Json.fromInt(number),
      "players" -> Json.arr(players*),
    )
    val rowPlayer = Json.obj(
      "averageRank" -> Json.fromDoubleOrNull(1.0),
      "memberId" -> Json.fromString("member-out-of-order"),
      "podiumRate" -> Json.fromDoubleOrNull(1.0),
      "qualityStatus" -> Json.fromString("ok"),
      "targetCount" -> Json.fromInt(1),
    )

    assert(validate(
      withEntries(entry(1, "regular")),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate),
      0,
      None
    ))
    assert(!validate(
      withEntries(entry(1, "additional")),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate),
      0,
      None
    ))
    assert(!validate(
      withEntries(entry(2, "regular"), entry(1, "regular")),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate),
      0,
      None,
    ))
    assert(!validate(
      withEntries(entry(1, "regular", rowPlayer)),
      simpleRequest(SeriesAnalysisChunkKind.Aggregate),
      0,
      None,
    ))

  test("accepts bounded variable focus IDs and rejects dependent semantic violations"):
    val context = sharedFixture("match-context-payload-v1.json")
    val expanded = context.hcursor
      .downField("match")
      .withFocus(_.mapObject(_.add(
        "focusedItemIds",
        Json.arr((1 to 13).map(index => Json.fromString(s"item-$index"))*),
      )))
      .top
      .getOrElse(fail("failed to expand focusedItemIds"))
    assertEquals(
      validate(
        expanded,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(1),
      ),
      true,
    )

    val overflow = context.hcursor
      .downField("match")
      .withFocus(_.mapObject(_.add(
        "focusedItemIds",
        Json.arr((1 to 14).map(index => Json.fromString(s"item-$index"))*),
      )))
      .top
      .getOrElse(fail("failed to overflow focusedItemIds"))
    assertEquals(
      validate(
        overflow,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(1),
      ),
      false,
    )

    val duplicated = context.hcursor
      .downField("match")
      .withFocus(_.mapObject(_.add(
        "focusedItemIds",
        Json.arr(Json.fromString("same"), Json.fromString("same")),
      )))
      .top
      .getOrElse(fail("failed to duplicate focusedItemIds"))
    assertEquals(
      validate(
        duplicated,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(1),
      ),
      false,
    )

    val underflow = context.hcursor
      .downField("match")
      .withFocus(_.mapObject(_.add(
        "focusedItemIds",
        Json.arr(Json.fromString("only-one")),
      )))
      .top
      .getOrElse(fail("failed to underflow focusedItemIds"))
    assertEquals(
      validate(
        underflow,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(1),
      ),
      false,
    )

    val duplicateRank = context.hcursor
      .downField("match")
      .downField("players")
      .withFocus(array => array.mapArray(values => values :+ values.head))
      .top
      .getOrElse(fail("failed to duplicate match rank"))
    assertEquals(
      validate(
        duplicateRank,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        2,
        Some(1),
      ),
      false,
    )

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
      itemCount: Int,
      revision: Option[Long],
  ): Boolean = SeriesAnalysisPayloadValidator.validate(json, request, itemCount, revision)

  private def sharedSchema(fileName: String): Json =
    parse(Files.readString(repositoryFile(s"docs/schemas/$fileName")))
      .fold(error => fail(s"invalid shared schema $fileName: $error"), identity)
end SeriesAnalysisPayloadValidatorSpec
