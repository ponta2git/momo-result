package momo.api.endpoints.codec

import momo.api.MomoCatsEffectSuite
import momo.api.domain.SeriesComparisonScope

final class SeriesComparisonCodecSpec extends MomoCatsEffectSuite:
  test("parses an omitted scope kind as overall"):
    val parsed = SeriesComparisonCodec.parseAggregateQuery("title_momotetsu_2", None, None)

    parsed match
      case Right(SeriesComparisonScope.Overall(gameTitleId)) =>
        assertEquals(gameTitleId.value, "title_momotetsu_2")
      case other => fail(s"expected overall scope, got $other")

  test("requires scope id for season and map scopes"):
    val season = SeriesComparisonCodec
      .parseAggregateQuery("title_momotetsu_2", Some("season"), None)
    val map = SeriesComparisonCodec.parseAggregateQuery("title_momotetsu_2", Some("map"), None)

    assertValidationError(season, "scopeId is required for season scope")
    assertValidationError(map, "scopeId is required for map scope")

  test("rejects scope id on overall and unknown scope kinds"):
    val overall = SeriesComparisonCodec
      .parseAggregateQuery("title_momotetsu_2", Some("overall"), Some("season_2026_spring"))
    val unknown = SeriesComparisonCodec.parseAggregateQuery("title_momotetsu_2", Some("bad"), None)

    assertValidationError(overall, "scopeId must be omitted for overall")
    assertValidationError(unknown, "scopeKind must be overall")

  private def assertValidationError(
      result: Either[momo.api.errors.AppError, SeriesComparisonScope],
      detailContains: String,
  ): Unit = result match
    case Left(error) =>
      assertEquals(error.code, "VALIDATION_FAILED")
      assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
    case Right(scope) => fail(s"expected validation error, got $scope")
