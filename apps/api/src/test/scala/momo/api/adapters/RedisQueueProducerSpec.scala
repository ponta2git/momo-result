package momo.api.adapters

import cats.effect.{IO, Ref}
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import dev.profunktor.redis4cats.Redis
import io.lettuce.core.Range
import java.util
import momo.api.config.RedisConfig
import momo.api.repositories.OcrQueuePayload
import momo.api.MomoCatsEffectSuite
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName
import scala.jdk.CollectionConverters.*
import scala.util.control.NonFatal

final class RedisQueueProducerSpec extends MomoCatsEffectSuite:
  test("publishes OCR payload fields to the configured Redis stream"):
    for
      ref <- Ref.of[IO, Vector[(String, Map[String, String])]](Vector.empty)
      client = new RedisStreamClient[IO]:
        override def xadd(stream: String, fields: Map[String, String]): IO[String] = ref
          .update(_ :+ (stream -> fields)).as("1-0")
      producer = RedisQueueProducer[IO]("momo:ocr:jobs", client)
      payload = OcrQueuePayload(Map("jobId" -> "job-1", "attempt" -> "1"))
      _ <- producer.publish(payload)
      published <- ref.get
    yield assertEquals(published, Vector("momo:ocr:jobs" -> payload.fields))

  test("publishes OCR payload fields to a Redis Streams Testcontainer"):
    val payload = OcrQueuePayload(Map(
      "jobId" -> "job-redis",
      "draftId" -> "draft-redis",
      "imageId" -> "image-redis",
      "imagePath" -> "/tmp/image.png",
      "requestedImageType" -> "total_assets",
      "attempt" -> "1",
      "enqueuedAt" -> "2026-04-29T10:00:00Z",
    ))
    redisContainer.use { container =>
      val redisUrl = s"redis://${container.getHost}:${container.getMappedPort(6379)}"
      val config = RedisConfig(redisUrl, "momo:ocr:jobs", "momo-ocr-workers")
      RedisQueueProducer.resource[IO](config).use { producer =>
        producer.publish(payload).flatMap { _ =>
          Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { commands =>
            commands.unsafe(_.xrange("momo:ocr:jobs", Range.unbounded[String]())).map { messages =>
              val body: util.Map[String, String] = messages.asScala.head.getBody
              assertEquals(body, payload.fields.asJava)
            }
          }
        }
      }
    }

  private def redisContainer: cats.effect.Resource[IO, GenericContainer[?]] = cats.effect.Resource
    .make {
      IO.blocking {
        val container = new GenericContainer(DockerImageName.parse("redis:7-alpine"))
        container.addExposedPort(6379)
        try container.start()
        catch case NonFatal(error) => assume(false, s"Docker is not available: ${error.getMessage}")
        container
      }
    }(container => IO.blocking(container.stop()))
