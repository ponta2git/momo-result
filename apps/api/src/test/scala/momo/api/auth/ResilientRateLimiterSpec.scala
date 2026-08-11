package momo.api.auth

import scala.concurrent.duration.*

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite

final class ResilientRateLimiterSpec extends MomoCatsEffectSuite:
  test("uses the primary decision without consulting the fallback"):
    for
      fallbackCalls <- Ref.of[IO, Int](0)
      limiter <- ResilientRateLimiter.create[IO](
        fixed(true),
        recording(false, fallbackCalls),
        100.millis,
        "read-api",
      )
      allowed <- limiter.allow("account-1")
      calls <- fallbackCalls.get
    yield
      assertEquals(allowed, true)
      assertEquals(calls, 0)

  test("uses the bounded local decision when the primary raises"):
    for
      fallbackCalls <- Ref.of[IO, Int](0)
      limiter <- ResilientRateLimiter.create[IO](
        _ => IO.raiseError(new RuntimeException("unavailable")),
        recording(false, fallbackCalls),
        100.millis,
        "mutation",
      )
      allowed <- limiter.allow("account-1")
      calls <- fallbackCalls.get
    yield
      assertEquals(allowed, false)
      assertEquals(calls, 1)

  test("bounds a stalled primary before using the local decision"):
    for
      fallbackCalls <- Ref.of[IO, Int](0)
      limiter <- ResilientRateLimiter.create[IO](
        _ => IO.never,
        recording(true, fallbackCalls),
        20.millis,
        "read-api",
      )
      allowed <- limiter.allow("account-1").timeout(1.second)
      calls <- fallbackCalls.get
    yield
      assertEquals(allowed, true)
      assertEquals(calls, 1)

  test("rejects unsafe configuration"):
    ResilientRateLimiter.create[IO](fixed(true), fixed(true), Duration.Zero, "read api").attempt.map {
      result => assert(result.isLeft)
    }

  private def fixed(allowed: Boolean): RateLimiter[IO] = _ => IO.pure(allowed)

  private def recording(allowed: Boolean, calls: Ref[IO, Int]): RateLimiter[IO] = _ =>
    calls.update(_ + 1).as(allowed)
