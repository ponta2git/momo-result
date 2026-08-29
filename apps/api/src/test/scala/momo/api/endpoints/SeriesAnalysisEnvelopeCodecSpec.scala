package momo.api.endpoints

import io.circe.syntax.*
import io.circe.{Json, JsonObject}
import munit.FunSuite

final class SeriesAnalysisEnvelopeCodecSpec extends FunSuite:
  test("encodes absent envelope values as explicit nulls and collections as required arrays"):
    val options = objectValue(SeriesAnalysisOptionsResponse(1, None, Nil).asJson)
    assertEquals(options("defaultGameTitleId"), Some(Json.Null))
    assertEquals(options("titles"), Some(Json.arr()))

    val status = objectValue(SeriesAnalysisStatusResponse(
      1,
      "title-envelope",
      SeriesAnalysisDesiredResponse("0", "series-analysis-v1", 1),
      "unavailable",
      None,
      None,
    ).asJson)
    assertEquals(status("currentArtifact"), Some(Json.Null))
    assertEquals(status("calculation"), Some(Json.Null))

    val recalculation = objectValue(SeriesAnalysisRecalculationAcceptedResponse(
      1,
      "request-envelope",
      "2026-08-29T00:00:00Z",
      0,
      None,
      None,
    ).asJson)
    assertEquals(recalculation("campaign"), Some(Json.Null))
    assertEquals(recalculation("target"), Some(Json.Null))

    val admin = objectValue(SeriesAnalysisAdminOverviewResponse(
      1,
      Nil,
      None,
      SeriesAnalysisGlobalExecutionResponse(0, 0, None, 0, None),
      Nil,
    ).asJson)
    assertEquals(admin("titleOptions"), Some(Json.arr()))
    assertEquals(admin("selectedTitle"), Some(Json.Null))
    assertEquals(admin("recentJobs"), Some(Json.arr()))
    val global = admin("globalExecution").flatMap(_.asObject)
      .getOrElse(fail("globalExecution must be an object"))
    assertEquals(global("oldestQueuedAt"), Some(Json.Null))
    assertEquals(global("latestActiveCampaign"), Some(Json.Null))

  private def objectValue(value: Json): JsonObject = value.asObject
    .getOrElse(fail("envelope must be an object"))
end SeriesAnalysisEnvelopeCodecSpec
