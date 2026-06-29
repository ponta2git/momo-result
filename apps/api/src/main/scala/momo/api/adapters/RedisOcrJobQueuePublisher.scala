package momo.api.adapters

import scala.jdk.CollectionConverters.*

import cats.Functor
import cats.effect.{Async, Resource}
import cats.syntax.functor.*
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import dev.profunktor.redis4cats.{Redis, RedisCommands}

import momo.api.contracts.ocrworker.OcrWorkerJobMessage
import momo.api.config.RedisConfig
import momo.api.ports.queue.{OcrJobEnqueueRequest, OcrJobQueueHealthCheck, OcrJobQueuePublisher}

trait RedisStreamClient[F[_]]:
  def xadd(stream: String, fields: Map[String, String]): F[String]
  def xlen(stream: String): F[Long]
  def ping: F[Unit]

final class RedisOcrJobQueuePublisher[F[_]] private (stream: String, client: RedisStreamClient[F])
    extends OcrJobQueuePublisher[F]:
  override def publish(request: OcrJobEnqueueRequest): F[String] =
    client.xadd(stream, OcrWorkerJobMessage.fromEnqueueRequest(request).fields)

object RedisOcrJobQueuePublisher:
  def apply[F[_]](stream: String, client: RedisStreamClient[F]): RedisOcrJobQueuePublisher[F] =
    new RedisOcrJobQueuePublisher(stream, client)

  def fromCommands[F[_]: Functor](
      stream: String,
      commands: RedisCommands[F, String, String],
  ): RedisOcrJobQueuePublisher[F] =
    RedisOcrJobQueuePublisher(stream, Redis4CatsStreamClient(commands))

  def healthProbeFromCommands[F[_]: Functor](
      deadLetterStream: String,
      commands: RedisCommands[F, String, String],
  ): OcrJobQueueHealthCheck[F] =
    RedisOcrJobQueueHealthCheck(deadLetterStream, Redis4CatsStreamClient(commands))

  def resource[F[_]: Async](config: RedisConfig): Resource[F, RedisOcrJobQueuePublisher[F]] =
    Redis[F].simple(config.url, RedisCodec.Utf8).map(commands => fromCommands(config.stream, commands))

private final class Redis4CatsStreamClient[F[_]: Functor](
    commands: RedisCommands[F, String, String]
) extends RedisStreamClient[F]:
  override def xadd(stream: String, fields: Map[String, String]): F[String] = commands
    .unsafe(_.xadd(stream, fields.asJava))
  override def xlen(stream: String): F[Long] = commands.unsafe[java.lang.Long](_.xlen(stream))
    .map(_.longValue)
  override def ping: F[Unit] = commands.ping.void

private final class RedisOcrJobQueueHealthCheck[F[_]](
    deadLetterStream: String,
    client: RedisStreamClient[F],
) extends OcrJobQueueHealthCheck[F]:
  override def ping: F[Unit] = client.ping
  override def deadLetterLength: F[Long] = client.xlen(deadLetterStream)
