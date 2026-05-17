package momo.api.adapters

import java.nio.file.Path
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.repositories.OcrQueuePayload
import momo.api.testing.{RecordingRedisStreamClient, RedisXAddCall}

final class RedisQueueProducerSpec extends MomoCatsEffectSuite:
  private def payloadFor(jobId: String): OcrQueuePayload = OcrQueuePayload.build(
    jobId = OcrJobId.unsafeFromString(jobId),
    draftId = OcrDraftId.unsafeFromString(s"draft-$jobId"),
    imageId = ImageId.unsafeFromString(s"image-$jobId"),
    imagePath = Path.of("/tmp/image.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attempt = 1,
    enqueuedAt = Instant.parse("2026-04-29T10:00:00Z"),
    hints = OcrJobHints.empty,
    requestId = None,
  )

  test("publishes OCR payload fields to the configured Redis stream"):
    for
      client <- RecordingRedisStreamClient.create
      producer = RedisQueueProducer[IO]("momo:ocr:jobs", client)
      payload = payloadFor("job-1")
      messageId <- producer.publish(payload)
      published <- client.calls
    yield
      assertEquals(messageId, "1-0")
      assertEquals(published, Vector(RedisXAddCall("momo:ocr:jobs", payload.fields)))
