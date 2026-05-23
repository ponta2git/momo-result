package momo.api.integration.redis

import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.IO

import momo.api.auth.{RedisOAuthProviderBackoff, RedisRateLimiter}
import momo.api.config.RedisConfig
import momo.api.errors.AppError

final class RedisRateLimiterIntegrationSpec extends RedisIntegrationSuite:

  test("RedisRateLimiter shares counters across limiter instances"):
    redisUrlResource.use { redisUrl =>
      val config = RedisConfig(redisUrl, "unused-stream", "unused-group")
      val namespace = s"login-test-${UUID.randomUUID().toString}"
      val now = IO.pure(Instant.parse("2026-05-14T00:00:00Z"))

      RedisRateLimiter.resource[IO](config, namespace, 2, now).use { firstLimiter =>
        RedisRateLimiter.resource[IO](config, namespace, 2, now).use { secondLimiter =>
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

  test("RedisOAuthProviderBackoff shares provider degraded state across instances"):
    redisUrlResource.use { redisUrl =>
      val config = RedisConfig(redisUrl, "unused-stream", "unused-group")
      val namespace = s"oauth-provider-test-${UUID.randomUUID().toString}"
      val now = IO.pure(Instant.parse("2026-05-14T00:00:00Z"))

      RedisOAuthProviderBackoff.resource[IO](config, namespace, 1, 60.seconds, now).use {
        firstBackoff =>
          RedisOAuthProviderBackoff.resource[IO](config, namespace, 1, 60.seconds, now).use {
            secondBackoff =>
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
