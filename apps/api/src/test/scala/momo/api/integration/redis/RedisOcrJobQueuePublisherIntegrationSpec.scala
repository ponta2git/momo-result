package momo.api.integration.redis
import java.time.Instant
import java.util
import java.util.UUID

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import io.lettuce.core.Range

import momo.api.adapters.redis.RedisOcrJobQueuePublisher
import momo.api.contracts.ocrworker.OcrWorkerJobMessageV2
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType, StoredImageLocation}
import momo.api.ports.queue.OcrJobEnqueueRequest

final class RedisOcrJobQueuePublisherIntegrationSpec extends RedisIntegrationSuite:
  private final case class RedisStreamFixture(
      redisUrl: String,
      streamName: String,
      deadLetterStreamName: String,
  )

  test("publishes OCR worker message fields to a Redis Streams Testcontainer"):
    val request = requestFor("job-redis")
    val expectedMessage = OcrWorkerJobMessageV2.fromEnqueueRequest(request).fold(fail(_), identity)
    redisStreamFixture.use { fixture =>
      Redis[IO].simple(fixture.redisUrl, RedisCodec.Utf8).use { commands =>
        val producer = RedisOcrJobQueuePublisher.fromCommands(fixture.streamName, commands)
        producer.publish(request).flatMap { messageId =>
          commands.unsafe(_.xrange(fixture.streamName, Range.unbounded[String]())).map { messages =>
            val rows = messages.asScala.toList
            assert(
              rows.nonEmpty,
              s"expected at least 1 message in stream=${fixture.streamName}",
            )
            assertEquals(messageId, rows.head.getId)
            val body: util.Map[String, String] = rows.head.getBody
            assertEquals(body, expectedMessage.fields.asJava)
          }
        }
      }
    }

  test("health probe reports dead-letter stream length"):
    redisStreamFixture.use { fixture =>
      Redis[IO].simple(fixture.redisUrl, RedisCodec.Utf8).use { commands =>
        val probe = RedisOcrJobQueuePublisher
          .healthProbeFromCommands[IO](fixture.deadLetterStreamName, commands)
        for
          empty <- probe.deadLetterLength
          _ <- commands.unsafe(
            _.xadd(fixture.deadLetterStreamName, Map("deadLetterReason" -> "QUEUE_FAILURE").asJava)
          )
          nonEmpty <- probe.deadLetterLength
        yield
          assertEquals(empty, 0L)
          assertEquals(nonEmpty, 1L)
      }
    }

  private def requestFor(jobId: String): OcrJobEnqueueRequest = OcrJobEnqueueRequest(
    jobId = OcrJobId.unsafeFromString(jobId),
    draftId = OcrDraftId.unsafeFromString(s"draft-$jobId"),
    imageId = ImageId.unsafeFromString(s"image-$jobId"),
    imageLocation = StoredImageLocation.unsafeFromString(s"source-images/v1/ab/image-$jobId.png"),
    imageSha256 = "ab" * 32,
    imageByteLength = 1L,
    imageMediaType = "image/png",
    requestedScreenType = ScreenType.TotalAssets,
    attempt = 1,
    enqueuedAt = Instant.parse("2026-04-29T10:00:00Z"),
    hints = OcrJobHints.empty,
    requestId = None,
  )

  private def redisStreamFixture: Resource[IO, RedisStreamFixture] = redisUrlResource.flatMap {
    redisUrl =>
      Resource.make {
        IO.delay(UUID.randomUUID().toString).map { suffix =>
          RedisStreamFixture(
            redisUrl,
            s"momo:ocr:v2:jobs:test:$suffix",
            s"momo:ocr:v2:jobs:dead:test:$suffix",
          )
        }
      }(fixture =>
        deleteStream(fixture.redisUrl, fixture.streamName) >>
          deleteStream(fixture.redisUrl, fixture.deadLetterStreamName)
      )
  }

  private def deleteStream(redisUrl: String, streamName: String): IO[Unit] = Redis[IO]
    .simple(redisUrl, RedisCodec.Utf8).use(_.del(streamName).void).handleErrorWith(_ => IO.unit)
end RedisOcrJobQueuePublisherIntegrationSpec
