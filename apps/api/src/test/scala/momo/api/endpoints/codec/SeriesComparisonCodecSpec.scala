package momo.api.endpoints.codec

import momo.api.MomoCatsEffectSuite
import momo.api.domain.SeriesComparisonScope

final class SeriesComparisonCodecSpec extends MomoCatsEffectSuite:
  test("parses an omitted scope kind as overall"):
    val parsed = SeriesComparisonCodec
      .parseAggregateQuery("title_momotetsu_2", None, None, None, None)

    parsed match
      case Right(SeriesComparisonScope.Overall(gameTitleId)) =>
        assertEquals(gameTitleId.value, "title_momotetsu_2")
      case other => fail(s"expected overall scope, got $other")

  test("requires scope id for season and map scopes"):
    val season = SeriesComparisonCodec
      .parseAggregateQuery("title_momotetsu_2", Some("season"), None, None, None)
    val map = SeriesComparisonCodec
      .parseAggregateQuery("title_momotetsu_2", Some("map"), None, None, None)

    assertValidationError(season, "scopeId is required for season scope")
    assertValidationError(map, "scopeId is required for map scope")

  test("rejects scope id on overall and unknown scope kinds"):
    val overall = SeriesComparisonCodec.parseAggregateQuery(
      "title_momotetsu_2",
      Some("overall"),
      Some("season_2026_spring"),
      None,
      None,
    )
    val unknown = SeriesComparisonCodec
      .parseAggregateQuery("title_momotetsu_2", Some("bad"), None, None, None)

    assertValidationError(overall, "scopeId must be omitted for overall")
    assertValidationError(unknown, "scopeKind must be overall")

  test("parses season and map filters as a combined scope"):
    val parsed = SeriesComparisonCodec.parseAggregateQuery(
      "title_momotetsu_2",
      None,
      None,
      Some("season_2026_spring"),
      Some("map_japan"),
    )

    parsed match
      case Right(SeriesComparisonScope.SeasonMap(gameTitleId, seasonMasterId, mapMasterId)) =>
        assertEquals(gameTitleId.value, "title_momotetsu_2")
        assertEquals(seasonMasterId.value, "season_2026_spring")
        assertEquals(mapMasterId.value, "map_japan")
      case other => fail(s"expected combined scope, got $other")

  test("parses review query as the selected analysis scope"):
    val parsed = SeriesComparisonCodec
      .parseReviewQuery("title_momotetsu_2", Some("season_2026_spring"), None)

    parsed match
      case Right(SeriesComparisonScope.Season(gameTitleId, seasonMasterId)) =>
        assertEquals(gameTitleId.value, "title_momotetsu_2")
        assertEquals(seasonMasterId.value, "season_2026_spring")
      case other => fail(s"expected review season scope, got $other")

  test("parses drilldown metric id as a constrained supported key"):
    val parsed = SeriesComparisonCodec.parseDrilldownQuery(
      "title_momotetsu_2",
      "rank.averageHistory",
      "member_ponta",
      None,
      None,
    )

    parsed match
      case Right((SeriesComparisonScope.Overall(_), metricId, memberId)) =>
        assertEquals(metricId.toString, "rank.averageHistory")
        assertEquals(memberId.value, "member_ponta")
      case other => fail(s"expected drilldown scope and metric id, got $other")

    val advanced = SeriesComparisonCodec.parseDrilldownQuery(
      "title_momotetsu_2",
      "rankAnalysis.unexpectedWins",
      "member_ponta",
      None,
      None,
    )
    assertEquals(advanced.map(_._2.toString), Right("rankAnalysis.unexpectedWins"))

  test("rejects malformed and unsupported drilldown metric ids at the endpoint boundary"):
    val malformed = SeriesComparisonCodec.parseDrilldownQuery(
      "title_momotetsu_2",
      "../rank.averageHistory",
      "member_ponta",
      None,
      None,
    )
    val unsupported = SeriesComparisonCodec.parseDrilldownQuery(
      "title_momotetsu_2",
      "rank.unknown",
      "member_ponta",
      None,
      None,
    )

    assertValidationError(malformed, "metricId")
    assertValidationError(unsupported, "rankAnalysis.unexpectedWins")

  test("rejects mixed legacy and filter scope query"):
    val mixed = SeriesComparisonCodec.parseAggregateQuery(
      "title_momotetsu_2",
      Some("season"),
      Some("season_2026_spring"),
      Some("season_2026_spring"),
      None,
    )

    assertValidationError(mixed, "scopeKind/scopeId or seasonMasterId/mapMasterId")

  private def assertValidationError(
      result: Either[momo.api.errors.AppError, ?],
      detailContains: String,
  ): Unit = result match
    case Left(error) =>
      assertEquals(error.code, "VALIDATION_FAILED")
      assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
    case Right(scope) => fail(s"expected validation error, got $scope")
