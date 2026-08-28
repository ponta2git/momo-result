package momo.api.adapters.redis

import scala.jdk.CollectionConverters.*

import dev.profunktor.redis4cats.RedisCommands

import momo.api.ports.queue.SeriesAnalysisQueuePublisher

final class RedisSeriesAnalysisQueuePublisher[F[_]] private (
    stream: String,
    commands: RedisCommands[F, String, String],
) extends SeriesAnalysisQueuePublisher[F]:
  override def publish(jobId: String): F[String] = commands.unsafe(_.xadd(
    stream,
    Map("schemaVersion" -> "1", "jobId" -> jobId).asJava,
  ))

object RedisSeriesAnalysisQueuePublisher:
  def fromCommands[F[_]](
      stream: String,
      commands: RedisCommands[F, String, String],
  ): RedisSeriesAnalysisQueuePublisher[F] = new RedisSeriesAnalysisQueuePublisher(
    stream,
    commands,
  )
