package momo.api.http

import java.time.Instant

import cats.effect.IO
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.domain.GameTitle
import momo.api.domain.ids.GameTitleId
import momo.api.http.HttpAssertions.{
  assertProblem,
  assertProblemDetailEquals,
  jsonField,
  optionalHeaderValue
}

final class SeriesAnalysisHttpSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  private val titleId = GameTitleId.unsafeFromString("title-http-analysis")
  private val app = ResourceFunFixture(seededWiredHttpAppResource(
    "momo-series-analysis-http",
    runtime =>
      runtime.gameTitles.create(
        GameTitle(
          titleId,
          "分析HTTP作品",
          "momotetsu2",
          1,
          Instant.parse("2026-08-09T00:00:00Z"),
        )
      ),
  ))

  app.test("v2 options and status are lightweight no-store reads") { httpApp =>
    for
      options <- httpApp.run(readGet(uri"/api/analytics/series-comparison/v2/options"))
      optionsBody <- options.as[Json]
      status <- httpApp.run(readGet(Uri.unsafeFromString(
        s"/api/analytics/series-comparison/v2/status?gameTitleId=${titleId.value}"
      )))
      statusBody <- status.as[Json]
    yield
      assertEquals(options.status, Status.Ok)
      assertEquals(
        optionalHeaderValue(options, CIString("Cache-Control")),
        Some("private, no-store"),
      )
      assertEquals(
        optionsBody.hcursor.downField("titles").downArray.get[String]("gameTitleId").toOption,
        Some(titleId.value),
      )
      assertEquals(jsonField[Int](optionsBody, "schemaVersion"), 1)
      assertEquals(status.status, Status.Ok)
      assertEquals(
        optionalHeaderValue(status, CIString("Cache-Control")),
        Some("private, no-store"),
      )
      assertEquals(jsonField[Int](statusBody, "schemaVersion"), 1)
      assertEquals(jsonField[String](statusBody, "gameTitleId"), titleId.value)
      assertEquals(jsonField[String](statusBody, "artifactFreshness"), "unavailable")
      assertEquals(
        statusBody.hcursor.downField("desired").get[String]("algorithmVersion"),
        Right("series-analysis-v4"),
      )
  }

  app.test("artifact endpoint never falls back to synchronous analysis") { httpApp =>
    val uri = Uri.unsafeFromString(
      s"/api/analytics/series-comparison/v2/aggregate?gameTitleId=${titleId
          .value}&artifactId=artifact-missing"
    )
    httpApp.run(readGet(uri)).flatMap(response =>
      assertProblem(
        response,
        Status.Gone,
        "ANALYSIS_ARTIFACT_EXPIRED",
        "no longer available",
      )
    )
  }

  app.test("title recalculation requires Idempotency-Key and replays the accepted contract") {
    httpApp =>
      val uri = uri"/api/admin/series-analysis/recalculations"
      val body = Json.obj("gameTitleId" -> Json.fromString(titleId.value))
      for
        missing <- httpApp.run(writePost(uri, body))
        first <- httpApp.run(writePost(uri, body, Some("analysis-http-idempotency")))
        firstBody <- first.as[Json]
        replay <- httpApp.run(writePost(uri, body, Some("analysis-http-idempotency")))
        replayBody <- replay.as[Json]
        _ <- assertProblemDetailEquals(
          missing,
          Status.UnprocessableContent,
          "VALIDATION_FAILED",
          "Idempotency-Key is required.",
        )
      yield
        assertEquals(first.status, Status.Accepted)
        assertEquals(replay.status, Status.Accepted)
        assertEquals(replayBody, firstBody)
        assertEquals(jsonField[Int](firstBody, "schemaVersion"), 1)
        assertEquals(jsonField[Int](firstBody, "targetCount"), 1)
        assertEquals(
          firstBody.hcursor.downField("target").get[String]("gameTitleId"),
          Right(titleId.value),
        )
        assertEquals(
          firstBody.hcursor.downField("target").get[String]("requestDisposition"),
          Right("created_job"),
        )
  }

  app.test("analysis administration is not exposed to a non-admin account") { httpApp =>
    val request = readGet(
      uri"/api/admin/series-analysis/overview",
      accountId = "account_akane_mami",
    )
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.Forbidden, "FORBIDDEN", "Administrator access")
    )
  }

  app.test("all-title mutation requires the explicit confirmation phrase") { httpApp =>
    val request = writePost(
      uri"/api/admin/series-analysis/recalculations/all",
      Json.obj("confirmation" -> Json.fromString("yes")),
      Some("analysis-all-invalid-confirmation"),
    )
    httpApp.run(request).flatMap(response =>
      assertProblem(
        response,
        Status.UnprocessableContent,
        "VALIDATION_FAILED",
        "all_titles",
      )
    )
  }
end SeriesAnalysisHttpSpec
