package momo.api.http

import cats.effect.testkit.TestControl
import cats.effect.{IO, Outcome, Resource}
import io.circe.Json

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.InMemoryIdempotencyRepository
import momo.api.auth.{AuthenticatedAccount, LoginRateLimiter}
import momo.api.domain.ids.AccountId
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError
import momo.api.repositories.{IdempotencyRepository, IdempotencyResponse}

final class IdempotencyRecordingSpec extends MomoCatsEffectSuite:
  private val now = java.time.Instant.parse("2026-05-14T00:00:00Z")
  private val account = AuthenticatedAccount(
    AccountId.unsafeFromString("account_ponta"),
    "ponta",
    true,
    None
  )
  private val endpoint = "POST /api/testing/recording"
  private val request = Json.obj("value" -> Json.fromString("same"))

  for
    successful <- List(true, false)
    cancelRequest <- List(true, false)
  do
    val operation = if successful then "complete" else "abandon"
    test(s"$operation stalled recording has a finite lifetime, cancellation=$cancelRequest") {
      TestControl.executeEmbed {
        val expected: Either[ProblemDetails.ProblemResponse, Json] =
          if successful then Right(Json.obj("saved" -> Json.fromBoolean(true)))
          else Left(ProblemDetails.from(AppError.Conflict("Mutation was rejected.")))
        for
          underlying <- InMemoryIdempotencyRepository.create[IO]
          started <- IO.deferred[Unit]
          stopped <- IO.ref(false)
          released <- IO.ref(false)
          attempts <- IO.ref(0)
          stalled = (started.complete(()).void *> IO.never[Unit]).onCancel(stopped.set(true))
          repository = new IdempotencyRepository[IO]:
            export underlying.{lookup, reserveWithinAccountLimit, cleanup}
            def complete(
                key: String,
                accountId: AccountId,
                endpoint: String,
                requestHash: Vector[Byte],
                response: IdempotencyResponse,
            ): IO[Unit] =
              if successful then stalled
              else underlying.complete(key, accountId, endpoint, requestHash, response)
            def abandon(
                key: String,
                accountId: AccountId,
                endpoint: String,
                requestHash: Vector[Byte],
            ): IO[Unit] =
              if successful then underlying.abandon(key, accountId, endpoint, requestHash)
              else stalled
          limiter <- LoginRateLimiter.create[IO](100, IO.pure(now))
          guard = IdempotencyReplay.Guard(repository, limiter, 100)
          mutation = attempts.update(_ + 1).as(expected)
          run = IdempotencyReplay.wrap[IO, Json, Json](
            guard,
            Some("stalled-recording"),
            account,
            endpoint,
            request,
            IO.pure(now),
            mutation
          )
          before <- IO.monotonic
          fiber <- Resource.make(IO.unit)(_ => released.set(true)).use(_ => run).start
          _ <- started.get
          _ <- if cancelRequest then fiber.cancel else IO.unit
          outcome <- fiber.join
          after <- IO.monotonic
          wasStopped <- stopped.get
          wasReleased <- released.get
          pending <- underlying.lookup("stalled-recording", account.accountId, endpoint)
          replay <- run
          count <- attempts.get
          _ <- outcome match
            case Outcome.Succeeded(value) if !cancelRequest => value.map(assertEquals(_, expected))
            case Outcome.Canceled() if cancelRequest => IO.unit
            case other => IO.raiseError(new AssertionError(s"Unexpected request outcome: $other"))
        yield
          assertEquals(after - before, IdempotencyReplay.RecordingTimeout)
          assert(wasStopped, "The recording child must be canceled before returning.")
          assert(wasReleased, "The request resource must be released before returning.")
          assertEquals(pending.map(_.response.status), Some(0))
          assertEquals(replay.left.toOption.map(_.body.code), Some("IDEMPOTENCY_IN_PROGRESS"))
          assertEquals(count, 1)
      }
    }

  test("a self-cancelled recording preserves the result and pending key without hanging") {
    TestControl.executeEmbed {
      val expected = Right(Json.obj("saved" -> Json.fromBoolean(true)))
      for
        underlying <- InMemoryIdempotencyRepository.create[IO]
        repository = new IdempotencyRepository[IO]:
          export underlying.{lookup, reserveWithinAccountLimit, abandon, cleanup}
          def complete(
              key: String,
              accountId: AccountId,
              endpoint: String,
              requestHash: Vector[Byte],
              response: IdempotencyResponse,
          ): IO[Unit] =
            val _ = (key, accountId, endpoint, requestHash, response)
            IO.canceled
        limiter <- LoginRateLimiter.create[IO](100, IO.pure(now))
        guard = IdempotencyReplay.Guard(repository, limiter, 100)
        result <- IdempotencyReplay.wrap[IO, Json, Json](
          guard,
          Some("cancelled-recording"),
          account,
          endpoint,
          request,
          IO.pure(now),
          IO.pure(expected)
        )
        pending <- underlying.lookup("cancelled-recording", account.accountId, endpoint)
      yield
        assertEquals(result, expected)
        assertEquals(pending.map(_.response.status), Some(0))
    }
  }
