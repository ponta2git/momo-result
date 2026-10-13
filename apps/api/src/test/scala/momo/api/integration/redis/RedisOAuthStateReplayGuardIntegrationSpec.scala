package momo.api.integration.redis

import java.time.Instant
import java.util.UUID

import cats.effect.IO
import cats.syntax.all.*
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*

import momo.api.adapters.redis.RedisOAuthStateReplayGuard

final class RedisOAuthStateReplayGuardIntegrationSpec extends RedisIntegrationSuite:
  test("state consumption is atomic across instances and retained for the full signed lifetime") {
    redisUrlResource.use { redisUrl =>
      val stateHash = UUID.randomUUID().toString
      val issuedAt = Instant.parse("2026-01-01T00:00:59Z")
      val expiresAt = issuedAt.plusSeconds(300)
      val redisKey = s"momo:oauth-state:used:$stateHash"
      Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { firstCommands =>
        Redis[IO].simple(redisUrl, RedisCodec.Utf8).use { secondCommands =>
          for
            now <- IO.ref(issuedAt)
            first = RedisOAuthStateReplayGuard(firstCommands, now.get)
            second = RedisOAuthStateReplayGuard(secondCommands, now.get)
            accepted <- (first.consume(stateHash, expiresAt), second.consume(stateHash, expiresAt))
              .parTupled
            ttl <- firstCommands.ttl(redisKey)
            _ <- now.set(issuedAt.plusSeconds(61))
            replay <- second.consume(stateHash, expiresAt)
            ttlAfterReplay <- secondCommands.ttl(redisKey)
            _ <- now.set(expiresAt)
            expired <- first.consume(UUID.randomUUID().toString, expiresAt)
          yield
            assertEquals(List(accepted._1, accepted._2).count(identity), 1)
            assert(ttl.exists(_.toSeconds >= 295L))
            assert(!replay)
            assert(ttlAfterReplay.exists(_.toSeconds >= 295L))
            assert(!expired)
        }
      }
    }
  }
