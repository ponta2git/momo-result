package momo.api.adapters.postgres

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

final class SeriesAnalysisPayloadValidatorSpec extends FunSuite:
  private val titleId = GameTitleId.unsafeFromString("title-payload-validator")
  private val overall = SeriesAnalysisScope.Overall

  test("accepts each bounded resource shape"):
    assertEquals(
      validate(aggregate, simpleRequest(SeriesAnalysisChunkKind.Aggregate), 0, None),
      true,
    )
    assertEquals(
      validate(review, simpleRequest(SeriesAnalysisChunkKind.Review), 0, None),
      true,
    )
    SeriesAnalysisDrilldownMetric.values.foreach { metric =>
      assertEquals(
        validate(
          drilldown(metric),
          request(SeriesAnalysisChunkKind.Drilldown, Some("member-1"), Some(metric), None),
          1,
          None,
        ),
        true,
        metric.id,
      )
    }
    assertEquals(
      validate(
        matchContext,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(7),
      ),
      true,
    )

  test("rejects unknown fields and manifest identity mismatches"):
    assertEquals(
      validate(
        aggregate.mapObject(_.add("unexpected", Json.True)),
        simpleRequest(SeriesAnalysisChunkKind.Aggregate),
        0,
        None,
      ),
      false,
    )
    assertEquals(
      validate(
        drilldown(SeriesAnalysisDrilldownMetric.RankAverageHistory),
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
        matchContext,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(8),
      ),
      false,
    )

  test("rejects negative aggregate denominators even when their sum matches"):
    val invalid = aggregate.mapObject(objectValue => objectValue
      .add("players", Json.arr(
        Json.obj("memberId" -> Json.fromString("member-1")),
        Json.obj("memberId" -> Json.fromString("member-2")),
      ))
      .add("metricsByPlayer", Json.arr(
        Json.obj(
          "memberId" -> Json.fromString("member-1"),
          "denominator" -> Json.fromLong(-1),
        ),
        Json.obj(
          "memberId" -> Json.fromString("member-2"),
          "denominator" -> Json.fromLong(1),
        ),
      )))

    assertEquals(
      validate(invalid, simpleRequest(SeriesAnalysisChunkKind.Aggregate), 0, None),
      false,
    )

  test("accepts bounded variable focus IDs and rejects duplicates"):
    val expanded = matchContext.hcursor
      .downField("match")
      .withFocus(_.mapObject(_.add(
        "focusedItemIds",
        Json.arr((1 to 11).map(index => Json.fromString(s"item-$index"))*),
      )))
      .top
      .getOrElse(fail("failed to expand focusedItemIds"))
    assertEquals(
      validate(
        expanded,
        request(SeriesAnalysisChunkKind.MatchContext, None, None, Some("match-1")),
        1,
        Some(7),
      ),
      true,
    )

    val duplicated = matchContext.hcursor
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
        Some(7),
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

  private def validate(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
      revision: Option[Long],
  ): Boolean = SeriesAnalysisPayloadValidator.validate(json, request, itemCount, revision)

  private def aggregate: Json = json(
    """{
      "schemaVersion":2,
      "scope":{"kind":"overall","matchCount":0},
      "players":[],
      "summary":{},
      "metricsByPlayer":[],
      "rankDistribution":[],
      "recentRanks":[],
      "strategyScatter":{},
      "playOrderComparison":[],
      "revenueRankConversion":[],
      "trends":[],
      "histograms":{},
      "headToHead":[],
      "momentumSwitch":{},
      "performanceProfiles":{},
      "assetStyleProfiles":{},
      "cardShopDestination":{},
      "matchDigest":[],
      "matchNoInEvent":[],
      "rankAnalysis":{},
      "highlights":[],
      "dataQuality":{},
      "metricDefinitions":[],
      "source":{}
    }"""
  )

  private def review: Json = json(
    """{
      "schemaVersion":2,
      "scope":{"kind":"overall","matchCount":0},
      "baseline":{},
      "commonPlaybookTopics":[],
      "playbookByPlayer":[],
      "dataQuality":{}
    }"""
  )

  private def drilldown(metric: SeriesAnalysisDrilldownMetric): Json =
    val detail = metric match
      case SeriesAnalysisDrilldownMetric.RankAverageHistory => Json.obj(
          "kind" -> Json.fromString("rank_average_history"),
          "summary" -> Json.obj("targetCount" -> Json.fromInt(1)),
          "matchRows" -> Json.arr(),
          "eventRows" -> Json.arr(),
        )
      case SeriesAnalysisDrilldownMetric.PlayOrderRankHistory => Json.obj(
          "kind" -> Json.fromString("play_order_rank_history"),
          "summary" -> Json.obj("targetCount" -> Json.fromInt(1)),
          "seriesByPlayOrder" -> Json.arr(),
          "rows" -> Json.arr(),
        )
      case SeriesAnalysisDrilldownMetric.RankSignals => Json.obj(
          "kind" -> Json.fromString("rank_signals"),
          "method" -> Json.obj(),
          "status" -> Json.fromString("insufficient_data"),
          "reasonCodes" -> Json.arr(),
          "heldEventCount" -> Json.fromInt(0),
          "matchCount" -> Json.fromInt(0),
          "improvedFoldCount" -> Json.fromInt(0),
          "candidates" -> Json.arr(),
        )
      case SeriesAnalysisDrilldownMetric.UnexpectedWins => Json.obj(
          "kind" -> Json.fromString("unexpected_wins"),
          "summary" -> Json.obj(),
          "rows" -> Json.arr(),
        )
    Json.obj(
      "schemaVersion" -> Json.fromInt(2),
      "scope" -> Json.obj(
        "kind" -> Json.fromString("overall"),
        "matchCount" -> Json.fromInt(1),
      ),
      "player" -> Json.obj("memberId" -> Json.fromString("member-1")),
      "payload" -> detail,
    )

  private def matchContext: Json = json(
    """{
      "schemaVersion":1,
      "scope":{"kind":"overall","matchCount":1},
      "matchId":"match-1",
      "sourceMatchRevision":"7",
      "match":{
        "matchIndex":1,
        "playedAt":"2026-08-09T00:00:00Z",
        "players":[{
          "memberId":"member-1",
          "rank":1,
          "totalAssetsManYen":100,
          "revenueManYen":10,
          "revenueRank":1,
          "revenueAssetRate":0.1,
          "previousRank":null,
          "cumulativeAverageBefore":null,
          "cumulativeAverageAfter":1,
          "cumulativeAverageDelta":null,
          "cumulativeAverageDirection":"first_observation"
        }],
        "focusedItemIds":["a","b","c"],
        "features":[]
      }
    }"""
  )

  private def json(value: String): Json = parse(value)
    .fold(error => fail(s"invalid fixture: $error"), identity)
end SeriesAnalysisPayloadValidatorSpec
