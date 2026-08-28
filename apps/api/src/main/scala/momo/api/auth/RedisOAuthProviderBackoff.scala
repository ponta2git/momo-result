package momo.api.auth

import java.time.Instant

import cats.effect.Sync
import cats.syntax.all.*
import dev.profunktor.redis4cats.RedisCommands
import dev.profunktor.redis4cats.effects.ScriptOutputType

import momo.api.errors.AppError

final class RedisOAuthProviderBackoff[F[_]: Sync] private (
    commands: RedisCommands[F, String, String],
    namespace: String,
    failureThreshold: Int,
    backoff: scala.concurrent.duration.FiniteDuration,
    now: F[Instant],
) extends OAuthProviderBackoff[F]:
  private val backoffKey = s"momo:oauth-provider:$namespace:backoff"
  private val failuresKey = s"momo:oauth-provider:$namespace:failures"

  override def isBlocked: F[Boolean] = commands.get(backoffKey).map(_.isDefined)

  override def recordFailure(error: AppError): F[Boolean] = error match
    case _: AppError.DependencyFailed =>
      for
        current <- now
        until = current.plusSeconds(backoff.toSeconds).getEpochSecond.toString
        opened <- commands.eval(
          RedisOAuthProviderBackoff.RecordFailureScript,
          ScriptOutputType.Integer,
          List(failuresKey, backoffKey),
          List(
            failureThreshold.toString,
            RedisOAuthProviderBackoff.expireSeconds(backoff),
            until,
          ),
        )
      yield opened == 1L
    case _ => recordSuccess.as(false)

  override def recordSuccess: F[Unit] = commands.del(failuresKey).void

object RedisOAuthProviderBackoff:
  private val RecordFailureScript =
    """if redis.call('EXISTS', KEYS[2]) == 1 then
      |  return 0
      |end
      |local count = redis.call('INCR', KEYS[1])
      |if count == 1 then
      |  redis.call('EXPIRE', KEYS[1], ARGV[2])
      |end
      |if count >= tonumber(ARGV[1]) then
      |  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[2])
      |  redis.call('DEL', KEYS[1])
      |  return 1
      |end
      |return 0""".stripMargin

  private def expireSeconds(duration: scala.concurrent.duration.FiniteDuration): String =
    duration.toSeconds.max(1L).toString

  def fromCommands[F[_]: Sync](
      commands: RedisCommands[F, String, String],
      namespace: String,
      failureThreshold: Int,
      backoff: scala.concurrent.duration.FiniteDuration,
      now: F[Instant],
  ): RedisOAuthProviderBackoff[F] =
    RedisOAuthProviderBackoff(commands, namespace, failureThreshold, backoff, now)
