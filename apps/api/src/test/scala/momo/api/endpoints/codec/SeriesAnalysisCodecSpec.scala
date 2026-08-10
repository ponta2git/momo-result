package momo.api.endpoints.codec

import munit.FunSuite

import momo.api.domain.ids.{GameTitleId, MapMasterId, MatchId, MemberId, SeasonMasterId}
import momo.api.domain.{SeriesAnalysisChunkKind, SeriesAnalysisDrilldownMetric, SeriesAnalysisScope}
import momo.api.errors.AppError

final class SeriesAnalysisCodecSpec extends FunSuite:
  private final case class RawChunk(
      kind: SeriesAnalysisChunkKind,
      artifactId: String,
      seasonId: Option[String],
      mapId: Option[String],
      memberId: Option[String],
      metricId: Option[String],
      matchId: Option[String],
  )

  private val gameTitleId = GameTitleId.unsafeFromString("title-analysis-codec")
  private val artifactId = "artifact-analysis-codec"

  test("maps all supported scope query shapes to an unrepresentably-valid scope"):
    val cases = List(
      (None, None, SeriesAnalysisScope.Overall),
      (
        Some("season-spring"),
        None,
        SeriesAnalysisScope.Season(SeasonMasterId.unsafeFromString("season-spring")),
      ),
      (
        None,
        Some("map-japan"),
        SeriesAnalysisScope.Map(MapMasterId.unsafeFromString("map-japan")),
      ),
      (
        Some("season-spring"),
        Some("map-japan"),
        SeriesAnalysisScope.SeasonMap(
          SeasonMasterId.unsafeFromString("season-spring"),
          MapMasterId.unsafeFromString("map-japan"),
        ),
      ),
    )

    cases.foreach { case (seasonId, mapId, expected) =>
      assertEquals(
        parse(raw(SeriesAnalysisChunkKind.Aggregate).copy(seasonId = seasonId, mapId = mapId))
          .map(_.scope),
        Right(expected),
      )
    }

  test("maps every supported drilldown metric without losing resource identity"):
    SeriesAnalysisDrilldownMetric.values.foreach { expected =>
      val result = parse(raw(SeriesAnalysisChunkKind.Drilldown).copy(
        memberId = Some("member-ponta"),
        metricId = Some(expected.id),
      ))

      assertEquals(
        result.map(value =>
          (
            value.gameTitleId,
            value.artifactId,
            value.memberId,
            value.metric,
          )
        ),
        Right((
          gameTitleId,
          artifactId,
          Some(MemberId.unsafeFromString("member-ponta")),
          Some(expected),
        ))
      )
    }

  test("maps match context identity and rejects fields belonging to another resource kind"):
    val valid = parse(raw(SeriesAnalysisChunkKind.MatchContext).copy(
      matchId = Some("match-analysis-codec"),
    ))
    assertEquals(
      valid.map(value => (value.matchId, value.memberId, value.metric)),
      Right((Some(MatchId.unsafeFromString("match-analysis-codec")), None, None)),
    )

    val invalidCases = List(
      parse(raw(SeriesAnalysisChunkKind.Aggregate).copy(memberId = Some("member-ponta"))),
      parse(raw(SeriesAnalysisChunkKind.Review).copy(matchId = Some("match-analysis-codec"))),
      parse(raw(SeriesAnalysisChunkKind.Drilldown).copy(memberId = Some("member-ponta"))),
      parse(raw(SeriesAnalysisChunkKind.MatchContext).copy(
        matchId = Some("match-analysis-codec"),
        metricId = Some(SeriesAnalysisDrilldownMetric.RankAverageHistory.id),
      )),
    )
    invalidCases.foreach(assertValidation(_, "Invalid analysis resource query."))

  test("rejects unsupported metrics and malformed opaque identifiers at the boundary"):
    assertValidation(
      parse(raw(SeriesAnalysisChunkKind.Drilldown).copy(
        memberId = Some("member-ponta"),
        metricId = Some("rank.unknown"),
      )),
      s"metricId must be one of: ${SeriesAnalysisDrilldownMetric.supportedIds.mkString(", ")}.",
    )
    assertValidation(
      parse(raw(SeriesAnalysisChunkKind.Aggregate).copy(artifactId = "../artifact")),
      "artifactId is invalid.",
    )
    assertValidation(
      parse(raw(SeriesAnalysisChunkKind.Aggregate).copy(seasonId = Some(" "))),
      "seasonMasterId must not be blank.",
    )

  private def raw(kind: SeriesAnalysisChunkKind): RawChunk = RawChunk(
    kind,
    artifactId,
    None,
    None,
    None,
    None,
    None,
  )

  private def parse(value: RawChunk) = SeriesAnalysisCodec.chunk(
    value.kind,
    gameTitleId.value,
    value.artifactId,
    value.seasonId,
    value.mapId,
    value.memberId,
    value.metricId,
    value.matchId,
  )

  private def assertValidation[A](result: Either[AppError, A], detail: String): Unit = result match
    case Left(AppError.ValidationFailed(actual)) => assertEquals(actual, detail)
    case other => fail(s"expected ValidationFailed($detail), got $other")

end SeriesAnalysisCodecSpec
