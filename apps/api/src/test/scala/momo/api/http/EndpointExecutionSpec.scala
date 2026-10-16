package momo.api.http

import java.time.Instant

import cats.effect.IO
import io.circe.Json

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.InMemoryIdempotencyRepository
import momo.api.auth.{AuthenticatedAccount, LoginRateLimiter}
import momo.api.domain.AccountRole
import momo.api.domain.ids.AccountId
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

final class EndpointExecutionSpec extends MomoCatsEffectSuite:
  private val now = IO.pure(Instant.parse("2026-05-14T00:00:00Z"))
  private val account = AuthenticatedAccount(
    AccountId.unsafeFromString("account-execution"),
    "Execution test",
    AccountRole.Admin,
    None,
  )
  private val operation = "PUT /api/testing/execution/:id"
  private val response = Json.obj("saved" -> Json.True)

  private def execution(limit: Int): IO[EndpointExecution[IO]] =
    for
      repository <- InMemoryIdempotencyRepository.create[IO]
      limiter <- LoginRateLimiter.create[IO](limit, now)
    yield new EndpointExecution(
      EndpointSecurity[IO](UnusedAuthPolicy),
      IdempotencyReplay.Guard(repository, limiter, 100),
      now,
    )

  private def mustNotDecode: Either[AppError, String] =
    fail("rejected and replayed requests must not decode a command")

  test("replay and rejection precede command decoding while path and raw payload identify retries") {
    for
      http <- execution(1)
      calls <- IO.ref(0)
      run = (_: String) => calls.update(_ + 1).as(Right[AppError, Json](response))
      raw = ("record-1", Json.obj("value" -> Json.fromString(" padded ")))
      first <- http.mutation(operation, Some("saved"), account, raw)(
        Right[AppError, String]("padded")
      )(run)(identity)
      replay <- http.mutation(operation, Some("saved"), account, raw)(mustNotDecode)(run)(identity)
      anotherPath <- http.mutation(operation, Some("saved"), account, ("record-2", raw._2))(
        mustNotDecode
      )(run)(identity)
      normalizedPayload <- http.mutation(
        operation,
        Some("saved"),
        account,
        (raw._1, Json.obj("value" -> Json.fromString("padded"))),
      )(mustNotDecode)(run)(identity)
      fresh <- http.mutation(operation, Some("fresh"), account, raw)(mustNotDecode)(run)(identity)
      count <- calls.get
    yield
      assertEquals(first, Right(response))
      assertEquals(replay, first)
      assertEquals(anotherPath.left.toOption.map(_.body.code), Some("IDEMPOTENCY_PAYLOAD_MISMATCH"))
      assertEquals(normalizedPayload.left.toOption.map(_.body.code), Some("IDEMPOTENCY_PAYLOAD_MISMATCH"))
      assertEquals(fresh.left.toOption.map(_.body.code), Some("TOO_MANY_REQUESTS"))
      assertEquals(count, 1)
  }

  test("a known command rejection releases the key so a corrected request can execute") {
    for
      http <- execution(10)
      calls <- IO.ref(0)
      run = (_: String) => calls.update(_ + 1).as(Right[AppError, Json](response))
      invalid <- http.mutation(operation, Some("correctable"), account, "invalid")(
        Left[AppError, String](AppError.ValidationFailed("invalid command"))
      )(run)(identity)
      corrected <- http.mutation(operation, Some("correctable"), account, "corrected")(
        Right[AppError, String]("corrected")
      )(run)(identity)
      count <- calls.get
    yield
      assertEquals(invalid.left.toOption.map(_.body.code), Some("VALIDATION_FAILED"))
      assertEquals(corrected, Right(response))
      assertEquals(count, 1)
  }

  private object UnusedAuthPolicy extends AuthPolicy[IO]:
    def authenticate(context: AuthRequestContext)
        : IO[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] =
      IO.raiseError(new IllegalStateException("authentication belongs to the endpoint security phase"))
