package momo.api.endpoints

import java.nio.file.Paths
import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, OcrFailure, OcrJob, OcrJobStatus, ScreenType}

/**
 * Roundtrip + golden-JSON guard for [[OcrJobResponse]].
 *
 * The two cases (`Queued` happy path and `Failed` with full failure detail) cover both branches of
 * the optional fields, so the golden snapshot will catch any accidental nesting / casing change in
 * `failure` when the OcrJob status is later refactored into a sealed ADT (Phase 2).
 */
final class OcrJobResponseRoundtripSpec extends FunSuite:

  private val createdAt = Instant.parse("2026-04-30T12:00:00Z")
  private val updatedAt = Instant.parse("2026-04-30T12:00:01Z")

  private val queuedJob = OcrJob(
    id = JobId("job_001"),
    draftId = DraftId("draft_001"),
    imageId = ImageId("image_001"),
    imagePath = Paths.get("/tmp/images/image_001.png"),
    requestedScreenType = ScreenType.TotalAssets,
    detectedScreenType = None,
    status = OcrJobStatus.Queued,
    attemptCount = 0,
    workerId = None,
    failure = None,
    startedAt = None,
    finishedAt = None,
    durationMs = None,
    createdAt = createdAt,
    updatedAt = updatedAt,
  )

  private val failedJob = queuedJob.copy(
    status = OcrJobStatus.Failed,
    attemptCount = 2,
    detectedScreenType = Some(ScreenType.Revenue),
    failure = Some(
      OcrFailure(
        code = FailureCode.OcrTimeout,
        message = "engine timed out after 30s",
        retryable = true,
        userAction = Some("retry later"),
      )
    ),
  )

  test("OcrJobResponse: encode → decode is identity (queued)"):
    val response = OcrJobResponse.from(queuedJob)
    assertEquals(response.asJson.as[OcrJobResponse], Right(response))

  test("OcrJobResponse: encode → decode is identity (failed)"):
    val response = OcrJobResponse.from(failedJob)
    assertEquals(response.asJson.as[OcrJobResponse], Right(response))

  test("OcrJobResponse: golden JSON pins the wire format (queued)"):
    val response = OcrJobResponse.from(queuedJob)
    val expected = parse("""
      {
        "jobId": "job_001",
        "draftId": "draft_001",
        "imageId": "image_001",
        "imagePath": "/tmp/images/image_001.png",
        "requestedImageType": "total_assets",
        "detectedImageType": null,
        "status": "queued",
        "attemptCount": 0,
        "failure": null,
        "createdAt": "2026-04-30T12:00:00Z",
        "updatedAt": "2026-04-30T12:00:01Z"
      }
    """).getOrElse(Json.Null)
    assertEquals(response.asJson, expected)

  test("OcrJobResponse: golden JSON pins the wire format (failed)"):
    val response = OcrJobResponse.from(failedJob)
    val expected = parse("""
      {
        "jobId": "job_001",
        "draftId": "draft_001",
        "imageId": "image_001",
        "imagePath": "/tmp/images/image_001.png",
        "requestedImageType": "total_assets",
        "detectedImageType": "revenue",
        "status": "failed",
        "attemptCount": 2,
        "failure": {
          "code": "OCR_TIMEOUT",
          "message": "engine timed out after 30s",
          "retryable": true,
          "userAction": "retry later"
        },
        "createdAt": "2026-04-30T12:00:00Z",
        "updatedAt": "2026-04-30T12:00:01Z"
      }
    """).getOrElse(Json.Null)
    assertEquals(response.asJson, expected)
end OcrJobResponseRoundtripSpec
