package momo.api.adapters.redis

import scala.jdk.CollectionConverters.*

import cats.syntax.all.*
import cats.{Functor, MonadThrow}
import dev.profunktor.redis4cats.RedisCommands

import momo.api.contracts.ocrworker.OcrWorkerJobMessageV2
import momo.api.ports.queue.{OcrJobEnqueueRequest, OcrJobQueueHealthCheck, OcrJobQueuePublisher}

final class RedisOcrJobQueuePublisher[F[_]: MonadThrow] private (
    stream: String,
    commands: RedisCommands[F, String, String],
) extends OcrJobQueuePublisher[F]:
  override def publish(request: OcrJobEnqueueRequest): F[String] =
    OcrWorkerJobMessageV2.fromEnqueueRequest(request)
      .leftMap(reason => new IllegalArgumentException(s"invalid OCR v2 queue payload: $reason"))
      .liftTo[F].flatMap(message => commands.unsafe(_.xadd(stream, message.fields.asJava)))

object RedisOcrJobQueuePublisher:
  def fromCommands[F[_]: MonadThrow](
      stream: String,
      commands: RedisCommands[F, String, String],
  ): RedisOcrJobQueuePublisher[F] =
    RedisOcrJobQueuePublisher(stream, commands)

  def healthProbeFromCommands[F[_]: Functor](
      deadLetterStream: String,
      commands: RedisCommands[F, String, String],
  ): OcrJobQueueHealthCheck[F] =
    RedisOcrJobQueueHealthCheck(deadLetterStream, commands)

private final class RedisOcrJobQueueHealthCheck[F[_]](
    deadLetterStream: String,
    commands: RedisCommands[F, String, String],
)(using Functor[F]) extends OcrJobQueueHealthCheck[F]:
  override def ping: F[Unit] = commands.ping.void
  override def deadLetterLength: F[Long] = commands
    .unsafe[java.lang.Long](_.xlen(deadLetterStream)).map(_.longValue)
