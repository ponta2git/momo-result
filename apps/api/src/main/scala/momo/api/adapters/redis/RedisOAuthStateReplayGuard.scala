package momo.api.adapters.redis

import java.time.{Duration, Instant}

import cats.effect.Sync
import cats.syntax.all.*
import dev.profunktor.redis4cats.RedisCommands
import dev.profunktor.redis4cats.effects.ScriptOutputType

import momo.api.auth.OAuthStateReplayGuard

final class RedisOAuthStateReplayGuard[F[_]: Sync](
    commands: RedisCommands[F, String, String],
    now: F[Instant],
) extends OAuthStateReplayGuard[F]:
  override def consume(stateHash: String, expiresAt: Instant): F[Boolean] = now.flatMap { current =>
    // A relative TTL does not require the Redis clock to agree with the API clock. Round up
    // so the consumed state can never disappear while its signed lifetime still remains.
    val remaining = Duration.between(current, expiresAt)
    if remaining.isNegative || remaining.isZero then false.pure[F]
    else
      val retentionMillis = remaining.toMillis + (if remaining.getNano % 1000000 == 0 then 0 else 1)
      commands.eval(
        RedisOAuthStateReplayGuard.ConsumeScript,
        ScriptOutputType.Integer,
        List(s"momo:oauth-state:used:$stateHash"),
        List(retentionMillis.toString),
      ).map(_ == 1L)
  }

object RedisOAuthStateReplayGuard:
  private val ConsumeScript =
    """if redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1]) then
      |  return 1
      |end
      |return 0""".stripMargin
