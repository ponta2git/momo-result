package momo.api.integration.redis

import java.util
import java.util.UUID

import scala.jdk.CollectionConverters.*

import cats.effect.IO
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import io.lettuce.core.Range

import momo.api.adapters.redis.RedisSeriesAnalysisQueuePublisher

final class RedisSeriesAnalysisQueuePublisherIntegrationSpec extends RedisIntegrationSuite:
  test("publishes the minimal versioned analysis delivery contract"):
    redisUrlResource.use { redisUrl =>
      val stream = s"momo:analysis:jobs:test:${UUID.randomUUID()}"
      Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { commands =>
        val publisher = RedisSeriesAnalysisQueuePublisher.fromCommands(stream, commands)
        for
          messageId <- publisher.publish("analysis-job-contract")
          messages <- commands.unsafe(_.xrange(stream, Range.unbounded[String]()))
          _ <- commands.del(stream)
        yield
          val rows = messages.asScala.toList
          assertEquals(rows.size, 1)
          assertEquals(rows.head.getId, messageId)
          val body: util.Map[String, String] = rows.head.getBody
          assertEquals(
            body,
            Map("schemaVersion" -> "1", "jobId" -> "analysis-job-contract").asJava,
          )
      }
    }
end RedisSeriesAnalysisQueuePublisherIntegrationSpec
