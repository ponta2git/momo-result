package momo.api.adapters

import java.nio.file.Path
import java.time.Instant

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.repositories.OcrQueuePayload

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
      ref <- Ref.of[IO, Vector[(String, Map[String, String])]](Vector.empty)
      client = new RedisStreamClient[IO]:
        override def xadd(stream: String, fields: Map[String, String]): IO[String] = ref
          .update(_ :+ (stream -> fields)).as("1-0")
        override def ping: IO[Unit] = IO.unit
      producer = RedisQueueProducer[IO]("momo:ocr:jobs", client)
      payload = payloadFor("job-1")
      messageId <- producer.publish(payload)
      published <- ref.get
    yield
      assertEquals(messageId, "1-0")
      assertEquals(published, Vector("momo:ocr:jobs" -> payload.fields))
