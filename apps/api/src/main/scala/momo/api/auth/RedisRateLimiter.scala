package momo.api.auth

import java.time.Instant

import scala.concurrent.duration.DurationInt

import cats.effect.{Async, Resource, Sync}
import cats.syntax.all.*
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import dev.profunktor.redis4cats.{Redis, RedisCommands}

import momo.api.config.RedisConfig

final class RedisRateLimiter[F[_]: Sync] private (
    commands: RedisCommands[F, String, String],
    namespace: String,
    maxPerMinute: Int,
    now: F[Instant],
) extends RateLimiter[F]:
  def allow(key: String): F[Boolean] =
    for
      current <- now
      minute = current.getEpochSecond / 60
      redisKey = s"momo:rate-limit:$namespace:$key:$minute"
      count <- commands.incr(redisKey)
      _ <- if count == 1L then commands.expire(redisKey, 2.minutes).void else Sync[F].unit
    yield count <= maxPerMinute.toLong

object RedisRateLimiter:
  def fromCommands[F[_]: Sync](
      commands: RedisCommands[F, String, String],
      namespace: String,
      maxPerMinute: Int,
      now: F[Instant],
  ): RedisRateLimiter[F] = RedisRateLimiter(commands, namespace, maxPerMinute, now)

  def resource[F[_]: Async](
      config: RedisConfig,
      namespace: String,
      maxPerMinute: Int,
      now: F[Instant],
  ): Resource[F, RedisRateLimiter[F]] = Redis[F].simple(config.url, RedisCodec.Utf8)
    .map(commands => fromCommands(commands, namespace, maxPerMinute, now))
