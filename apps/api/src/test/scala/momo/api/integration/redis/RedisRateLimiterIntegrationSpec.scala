package momo.api.integration.redis

import java.time.Instant
import java.util.UUID

import cats.effect.IO

import momo.api.auth.RedisRateLimiter
import momo.api.config.RedisConfig

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
end RedisRateLimiterIntegrationSpec
