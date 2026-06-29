package momo.api.adapters.redis
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.contracts.ocrworker.OcrWorkerJobMessage
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType, StoredImageLocation}
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.testing.{RecordingRedisStreamClient, RedisXAddCall}

final class RedisOcrJobQueuePublisherSpec extends MomoCatsEffectSuite:
  private def requestFor(jobId: String): OcrJobEnqueueRequest = OcrJobEnqueueRequest(
    jobId = OcrJobId.unsafeFromString(jobId),
    draftId = OcrDraftId.unsafeFromString(s"draft-$jobId"),
    imageId = ImageId.unsafeFromString(s"image-$jobId"),
    imageLocation = StoredImageLocation.unsafeFromString("/tmp/image.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attempt = 1,
    enqueuedAt = Instant.parse("2026-04-29T10:00:00Z"),
    hints = OcrJobHints.empty,
    requestId = None,
  )

  test("publishes OCR worker message fields to the configured Redis stream"):
    for
      client <- RecordingRedisStreamClient.create
      producer = RedisOcrJobQueuePublisher[IO]("momo:ocr:jobs", client)
      request = requestFor("job-1")
      expectedMessage = OcrWorkerJobMessage.fromEnqueueRequest(request)
      messageId <- producer.publish(request)
      published <- client.calls
    yield
      assertEquals(messageId, "1-0")
      assertEquals(published, Vector(RedisXAddCall("momo:ocr:jobs", expectedMessage.fields)))
