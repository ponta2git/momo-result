package momo.api.integration.redis

import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.IO
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*

import momo.api.auth.{RedisOAuthProviderBackoff, RedisRateLimiter}
import momo.api.errors.AppError

final class RedisRateLimiterIntegrationSpec extends RedisIntegrationSuite:

  test("RedisRateLimiter shares counters across limiter instances"):
    redisUrlResource.use { redisUrl =>
      val namespace = s"login-test-${UUID.randomUUID().toString}"
      val now = IO.pure(Instant.parse("2026-05-14T00:00:00Z"))

      Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { firstCommands =>
        Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { secondCommands =>
          val firstLimiter = RedisRateLimiter.fromCommands(firstCommands, namespace, 2, now)
          val secondLimiter = RedisRateLimiter.fromCommands(secondCommands, namespace, 2, now)
          for
            first <- firstLimiter.allow("ip")
            second <- secondLimiter.allow("ip")
            third <- firstLimiter.allow("ip")
          yield
            assert(first)
            assert(second)
            assert(!third)
        }
      }
    }

  test("RedisRateLimiter sets an expiry on the minute counter"):
    redisUrlResource.use { redisUrl =>
      val namespace = s"login-ttl-test-${UUID.randomUUID().toString}"
      val current = Instant.parse("2026-05-14T00:00:00Z")
      val now = IO.pure(current)
      val minute = current.getEpochSecond / 60
      val redisKey = s"momo:rate-limit:$namespace:ip:$minute"

      Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { commands =>
        val limiter = RedisRateLimiter.fromCommands(commands, namespace, 2, now)
        for
          allowed <- limiter.allow("ip")
          ttl <- commands.ttl(redisKey)
        yield
          assert(allowed)
          assert(ttl.exists(_.toSeconds > 0L))
      }
    }

  test("RedisOAuthProviderBackoff shares provider degraded state across instances"):
    redisUrlResource.use { redisUrl =>
      val namespace = s"oauth-provider-test-${UUID.randomUUID().toString}"
      val now = IO.pure(Instant.parse("2026-05-14T00:00:00Z"))

      Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { firstCommands =>
        Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { secondCommands =>
          val firstBackoff =
            RedisOAuthProviderBackoff.fromCommands(firstCommands, namespace, 1, 60.seconds, now)
          val secondBackoff =
            RedisOAuthProviderBackoff.fromCommands(secondCommands, namespace, 1, 60.seconds, now)
          for
            initiallyBlocked <- secondBackoff.isBlocked
            opened <- firstBackoff.recordFailure(AppError.DependencyFailed("provider failed"))
            blocked <- secondBackoff.isBlocked
          yield
            assert(!initiallyBlocked)
            assert(opened)
            assert(blocked)
        }
      }
    }
end RedisRateLimiterIntegrationSpec
