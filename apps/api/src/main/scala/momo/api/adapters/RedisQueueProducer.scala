package momo.api.adapters

import scala.jdk.CollectionConverters.*

import cats.Functor
import cats.effect.{Async, Resource}
import cats.syntax.functor.*
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import dev.profunktor.redis4cats.{Redis, RedisCommands}

import momo.api.config.RedisConfig
import momo.api.repositories.{OcrQueuePayload, QueueProducer}

trait RedisStreamClient[F[_]]:
  def xadd(stream: String, fields: Map[String, String]): F[String]

final class RedisQueueProducer[F[_]: Functor] private (stream: String, client: RedisStreamClient[F])
    extends QueueProducer[F]:
  override def publish(payload: OcrQueuePayload): F[Unit] = client.xadd(stream, payload.fields).void

object RedisQueueProducer:
  def apply[F[_]: Functor](stream: String, client: RedisStreamClient[F]): RedisQueueProducer[F] =
    new RedisQueueProducer(stream, client)

  def resource[F[_]: Async](config: RedisConfig): Resource[F, RedisQueueProducer[F]] = Redis[F]
    .simple(config.url, RedisCodec.Utf8)
    .map(commands => RedisQueueProducer(config.stream, Redis4CatsStreamClient(commands)))

private final class Redis4CatsStreamClient[F[_]](commands: RedisCommands[F, String, String])
    extends RedisStreamClient[F]:
  override def xadd(stream: String, fields: Map[String, String]): F[String] = commands
    .unsafe(_.xadd(stream, fields.asJava))
