package momo.api.adapters

import java.util
import java.util.UUID

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Ref}
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import io.lettuce.core.Range
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName

import momo.api.MomoCatsEffectSuite
import momo.api.config.RedisConfig
import momo.api.repositories.OcrQueuePayload

final class RedisQueueProducerSpec extends MomoCatsEffectSuite:
  private val Integration = new munit.Tag("Integration")

  private final case class RedisStreamFixture(redisUrl: String, streamName: String)

  test("publishes OCR payload fields to the configured Redis stream"):
    for
      ref <- Ref.of[IO, Vector[(String, Map[String, String])]](Vector.empty)
      client = new RedisStreamClient[IO]:
        override def xadd(stream: String, fields: Map[String, String]): IO[String] = ref
          .update(_ :+ (stream -> fields)).as("1-0")
        override def ping: IO[Unit] = IO.unit
      producer = RedisQueueProducer[IO]("momo:ocr:jobs", client)
      payload = OcrQueuePayload(Map("jobId" -> "job-1", "attempt" -> "1"))
      messageId <- producer.publish(payload)
      published <- ref.get
    yield
      assertEquals(messageId, "1-0")
      assertEquals(published, Vector("momo:ocr:jobs" -> payload.fields))

  test("publishes OCR payload fields to a Redis Streams Testcontainer".tag(Integration)):
    val payload = OcrQueuePayload(Map(
      "jobId" -> "job-redis",
      "draftId" -> "draft-redis",
      "imageId" -> "image-redis",
      "imagePath" -> "/tmp/image.png",
      "requestedImageType" -> "total_assets",
      "attempt" -> "1",
      "enqueuedAt" -> "2026-04-29T10:00:00Z",
    ))
    redisStreamFixture.use { fixture =>
      val config = RedisConfig(fixture.redisUrl, fixture.streamName, "momo-ocr-workers")
      RedisQueueProducer.resource[IO](config).use { producer =>
        producer.publish(payload).flatMap { messageId =>
          Redis[IO].simple(fixture.redisUrl, RedisCodec.Utf8).use { commands =>
            commands.unsafe(_.xrange(fixture.streamName, Range.unbounded[String]())).map {
              messages =>
                val rows = messages.asScala.toList
                assert(
                  rows.nonEmpty,
                  s"expected at least 1 message in stream=${fixture.streamName}",
                )
                assertEquals(messageId, rows.head.getId)
                val body: util.Map[String, String] = rows.head.getBody
                assertEquals(body, payload.fields.asJava)
            }
          }
        }
      }
    }

  private def redisStreamFixture: cats.effect.Resource[IO, RedisStreamFixture] = redisUrlResource
    .flatMap { redisUrl =>
      cats.effect.Resource.make {
        IO.pure(RedisStreamFixture(redisUrl, s"momo:ocr:jobs:test:${UUID.randomUUID().toString}"))
      }(fixture => deleteStream(fixture.redisUrl, fixture.streamName))
    }

  private def deleteStream(redisUrl: String, streamName: String): IO[Unit] = Redis[IO]
    .simple(redisUrl, RedisCodec.Utf8).use(_.del(streamName).void).handleErrorWith(_ => IO.unit)

  private def redisContainer: cats.effect.Resource[IO, GenericContainer[?]] = cats.effect.Resource
    .make {
      IO.blocking {
        val container = new GenericContainer(DockerImageName.parse("redis:7-alpine"))
        container.addExposedPort(6379)
        container.start()
        container
      }
    }(container => IO.blocking(container.stop()))

  private def redisUrlResource: cats.effect.Resource[IO, String] = redisContainer
    .map(container => s"redis://${container.getHost}:${container.getMappedPort(6379)}")
    .handleErrorWith { containerError =>
      val fallback = sys.env.getOrElse("MOMO_TEST_REDIS_URL", "redis://127.0.0.1:6379")
      cats.effect.Resource
        .eval(Redis[IO].simple(fallback, RedisCodec.Utf8).use(_.ping).attempt.flatMap {
          case Right(_) => IO.pure(fallback)
          case Left(fallbackError) => IO.raiseError(new RuntimeException(
              s"Redis test setup failed. Testcontainers: ${containerError.getMessage}. " +
                s"Fallback $fallback: ${fallbackError.getMessage}"
            ))
        })
    }
