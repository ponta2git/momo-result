package momo.api.adapters.redis

import cats.Functor
import dev.profunktor.redis4cats.RedisCommands

import momo.api.ports.queue.SeriesAnalysisQueuePublisher

final class RedisSeriesAnalysisQueuePublisher[F[_]] private (
    stream: String,
    client: RedisStreamClient[F],
) extends SeriesAnalysisQueuePublisher[F]:
  override def publish(jobId: String): F[String] = client.xadd(
    stream,
    Map("schemaVersion" -> "1", "jobId" -> jobId),
  )

object RedisSeriesAnalysisQueuePublisher:
  def fromCommands[F[_]: Functor](
      stream: String,
      commands: RedisCommands[F, String, String],
  ): RedisSeriesAnalysisQueuePublisher[F] = new RedisSeriesAnalysisQueuePublisher(
    stream,
    Redis4CatsStreamClient(commands),
  )
