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
    ResilientRateLimiter.create[IO](
      fixed(true),
      fixed(true),
      Duration.Zero,
      "read api"
    ).attempt.map {
      case Left(error: IllegalArgumentException) =>
        assertEquals(
          error.getMessage,
          "ResilientRateLimiter requires a positive timeout and a safe non-empty scope",
        )
      case other => fail(s"expected IllegalArgumentException, got $other")
    }

  test("uses one fallback decision per outage and returns to the primary after recovery"):
    for
      primaryAvailable <- Ref.of[IO, Boolean](false)
      fallbackCalls <- Ref.of[IO, Int](0)
      primary: RateLimiter[IO] = _ =>
        primaryAvailable.get.flatMap {
          case true => IO.pure(true)
          case false => IO.raiseError(new RuntimeException("unavailable"))
        }
      limiter <- ResilientRateLimiter.create[IO](
        primary,
        recording(false, fallbackCalls),
        100.millis,
        "mutation",
      )
      first <- limiter.allow("account-1")
      second <- limiter.allow("account-1")
      _ <- primaryAvailable.set(true)
      recovered <- limiter.allow("account-1")
      steady <- limiter.allow("account-1")
      calls <- fallbackCalls.get
    yield
      assertEquals((first, second), (false, false))
      assertEquals((recovered, steady), (true, true))
      assertEquals(calls, 2)

  private def fixed(allowed: Boolean): RateLimiter[IO] = _ => IO.pure(allowed)

  private def recording(allowed: Boolean, calls: Ref[IO, Int]): RateLimiter[IO] = _ =>
    calls.update(_ + 1).as(allowed)
