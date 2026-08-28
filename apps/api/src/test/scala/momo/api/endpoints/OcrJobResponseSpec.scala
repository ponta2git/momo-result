package momo.api.endpoints

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, OcrFailure, OcrJob, ScreenType, StoredImageLocation}

final class OcrJobResponseSpec extends FunSuite:
  test("maps terminal OCR failure details needed by the client recovery flow"):
    val createdAt = Instant.parse("2026-04-30T12:00:00Z")
    val updatedAt = Instant.parse("2026-04-30T12:00:01Z")
    val response = OcrJobResponse.from(OcrJob.Failed(
      id = OcrJobId.unsafeFromString("job_001"),
      draftId = OcrDraftId.unsafeFromString("draft_001"),
      imageId = ImageId.unsafeFromString("image_001"),
      imageLocation = StoredImageLocation.unsafeFromString("source-images/job_001.png"),
      requestedScreenType = ScreenType.TotalAssets,
      failedDetectedScreenType = Some(ScreenType.Revenue),
      attemptCount = 2,
      failedWorkerId = None,
      failedFailure = OcrFailure(
        code = FailureCode.OcrTimeout,
        message = "engine timed out",
        retryable = true,
        userAction = Some("retry later"),
      ),
      failedStartedAt = None,
      failedFinishedAt = updatedAt,
      failedDurationMs = None,
      createdAt = createdAt,
      updatedAt = updatedAt,
    ))

    assertEquals(response.status, "failed")
    assertEquals(response.detectedScreenType, Some("revenue"))
    assertEquals(
      response.failure,
      Some(OcrFailureResponse(
        "OCR_TIMEOUT",
        "engine timed out",
        retryable = true,
        userAction = Some("retry later"),
      )),
    )

end OcrJobResponseSpec
