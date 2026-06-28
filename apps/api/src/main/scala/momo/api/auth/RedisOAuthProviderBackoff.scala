package momo.api.auth

import java.time.Instant

import cats.effect.{Async, Resource, Sync}
import cats.syntax.all.*
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import dev.profunktor.redis4cats.{Redis, RedisCommands}

import momo.api.config.RedisConfig
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
        count <- commands.incr(failuresKey)
        _ <- if count == 1L then commands.expire(failuresKey, backoff).void else Sync[F].unit
        opened <- if count >= failureThreshold.toLong then openBackoff else Sync[F].pure(false)
      yield opened
    case _ => recordSuccess.as(false)

  override def recordSuccess: F[Unit] = commands.del(failuresKey).void

  private def openBackoff: F[Boolean] =
    for
      current <- now
      until = current.plusSeconds(backoff.toSeconds).getEpochSecond.toString
      _ <- commands.set(backoffKey, until)
      _ <- commands.expire(backoffKey, backoff).void
      _ <- commands.del(failuresKey).void
    yield true

object RedisOAuthProviderBackoff:
  def fromCommands[F[_]: Sync](
      commands: RedisCommands[F, String, String],
      namespace: String,
      failureThreshold: Int,
      backoff: scala.concurrent.duration.FiniteDuration,
      now: F[Instant],
  ): RedisOAuthProviderBackoff[F] =
    RedisOAuthProviderBackoff(commands, namespace, failureThreshold, backoff, now)

  def resource[F[_]: Async](
      config: RedisConfig,
      namespace: String,
      failureThreshold: Int,
      backoff: scala.concurrent.duration.FiniteDuration,
      now: F[Instant],
  ): Resource[F, RedisOAuthProviderBackoff[F]] = Redis[F].simple(config.url, RedisCodec.Utf8)
    .map(commands => fromCommands(commands, namespace, failureThreshold, backoff, now))
