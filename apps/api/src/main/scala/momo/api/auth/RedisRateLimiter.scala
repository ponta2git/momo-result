package momo.api.auth

import java.time.Instant

import cats.effect.Sync
import cats.syntax.all.*
import dev.profunktor.redis4cats.RedisCommands
import dev.profunktor.redis4cats.effects.ScriptOutputType

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
      count <- commands.eval(
        RedisRateLimiter.IncrementAndExpireScript,
        ScriptOutputType.Integer,
        List(redisKey),
        List(RedisRateLimiter.ExpireSeconds),
      )
    yield count <= maxPerMinute.toLong

object RedisRateLimiter:
  private val ExpireSeconds = "120"
  private val IncrementAndExpireScript =
    """local count = redis.call('INCR', KEYS[1])
      |if count == 1 then
      |  redis.call('EXPIRE', KEYS[1], ARGV[1])
      |end
      |return count""".stripMargin

  def fromCommands[F[_]: Sync](
      commands: RedisCommands[F, String, String],
      namespace: String,
      maxPerMinute: Int,
      now: F[Instant],
  ): RedisRateLimiter[F] = RedisRateLimiter(commands, namespace, maxPerMinute, now)
