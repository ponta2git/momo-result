package momo.api.http

import cats.effect.{Deferred, IO, Ref}
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status, Uri}

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.InMemoryIdempotencyRepository
import momo.api.auth.{AuthenticatedAccount, LoginRateLimiter}
import momo.api.config.ResourceLimitsConfig
import momo.api.domain.ids.{AccountId, MemberId}
import momo.api.endpoints.ProblemDetails
import momo.api.http.HttpAssertions.{assertProblem, jsonField}

final class IdempotencyIntegrationSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:

  private val app = ResourceFunFixture(wiredHttpAppResource("momo-api-idempotency"))
  private val mutationRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-mutation-rate-limit",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(mutationRateLimitPerMinute = 0)),
  ))
  private val activeKeyLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-idempotency-active-key-limit",
    _.copy(resourceLimits =
      ResourceLimitsConfig.defaults
        .copy(mutationRateLimitPerMinute = 100, idempotencyActiveKeyLimitPerAccount = 1)
    ),
  ))
  private val directLimiterNow = java.time.Instant.parse("2026-05-14T00:00:00Z")

  private def idempotencyGuard(
      repo: InMemoryIdempotencyRepository[IO]
  ): IO[IdempotencyReplay.Guard[IO]] =
    idempotencyGuard(repo, mutationLimit = 100, activeKeyLimit = 100)

  private def idempotencyGuard(
      repo: InMemoryIdempotencyRepository[IO],
      mutationLimit: Int,
      activeKeyLimit: Int,
  ): IO[IdempotencyReplay.Guard[IO]] = LoginRateLimiter
    .create[IO](mutationLimit, IO.pure(directLimiterNow))
    .map(limiter => IdempotencyReplay.Guard(repo, limiter, activeKeyLimit))

  private def heldEventReq(idemKey: Option[String], heldAt: String): Request[IO] =
    Request[IO](Method.POST, uri"/api/held-events")
      .putHeaders(devWriteHeadersWithIdempotency(idemKey)*)
      .withEntity(HttpRequestBodies.Matches.createHeldEvent(heldAt))

  private def deleteHeldEventReq(idemKey: Option[String], heldEventId: String): Request[IO] =
    Request[IO](Method.DELETE, Uri.unsafeFromString(s"/api/held-events/$heldEventId"))
      .putHeaders(devWriteHeadersWithIdempotency(idemKey)*)

  private def createMatchDraftReq: Request[IO] = Request[IO](Method.POST, uri"/api/match-drafts")
    .putHeaders(devWriteHeaders()*).withEntity(HttpRequestBodies.Matches.emptyMatchDraft)

  private def cancelMatchDraftReq(idemKey: Option[String], matchDraftId: String): Request[IO] =
    Request[IO](Method.POST, Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/cancel"))
      .putHeaders(devWriteHeadersWithIdempotency(idemKey)*)

  app.test("idempotency: same key + same body replays response and skips side-effect") { httpApp =>
    for
      first <- httpApp.run(heldEventReq(Some("key-1"), "2024-01-01T00:00:00Z"))
      firstBody <- first.as[Json]
      second <- httpApp.run(heldEventReq(Some("key-1"), "2024-01-01T00:00:00Z"))
      secondBody <- second.as[Json]
      listRes <- httpApp
        .run(Request[IO](Method.GET, uri"/api/held-events?limit=50").putHeaders(devReadHeader()))
      listBody <- listRes.as[Json]
    yield
      assertEquals(first.status, Status.Ok)
      assertEquals(second.status, Status.Ok)
      assertEquals(firstBody, secondBody)
      val items = jsonField[List[Json]](listBody, "items")
      assertEquals(items.size, 1)
  }

  app.test("idempotency: same key + different body returns 409 Conflict") { httpApp =>
    for
      first <- httpApp.run(heldEventReq(Some("key-2"), "2024-02-01T00:00:00Z"))
      _ = assertEquals(first.status, Status.Ok)
      second <- httpApp.run(heldEventReq(Some("key-2"), "2024-03-01T00:00:00Z"))
      _ <- assertProblem(second, Status.Conflict, "IDEMPOTENCY_PAYLOAD_MISMATCH", "Idempotency-Key")
    yield ()
  }

  mutationRateLimitApp.test(
    "idempotency: JSON mutations without a key still use the common mutation rate limit"
  ) { httpApp =>
    httpApp.run(heldEventReq(None, "2024-02-02T00:00:00Z")).flatMap { response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "mutation")
    }
  }

  activeKeyLimitApp
    .test("idempotency: active key limit blocks fresh keys but allows replay") { httpApp =>
      for
        first <- httpApp.run(heldEventReq(Some("key-limit-a"), "2024-02-03T00:00:00Z"))
        _ = assertEquals(first.status, Status.Ok)
        firstBody <- first.as[Json]
        replay <- httpApp.run(heldEventReq(Some("key-limit-a"), "2024-02-03T00:00:00Z"))
        replayBody <- replay.as[Json]
        blocked <- httpApp.run(heldEventReq(Some("key-limit-b"), "2024-02-04T00:00:00Z"))
        _ <- assertProblem(blocked, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Idempotency-Key")
        listRes <- httpApp
          .run(Request[IO](Method.GET, uri"/api/held-events?limit=50").putHeaders(devReadHeader()))
        listBody <- listRes.as[Json]
      yield
        assertEquals(replay.status, Status.Ok)
        assertEquals(replayBody, firstBody)
        val items = jsonField[List[Json]](listBody, "items")
        assertEquals(items.size, 1)
    }

  test("idempotency: in-flight same key returns a specific 409 code") {
    val account = AuthenticatedAccount(
      accountId = AccountId.unsafeFromString("account_ponta"),
      displayName = "ponta",
      isAdmin = true,
      playerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    )
    val request = Json.obj("value" -> Json.fromString("same"))
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      guard <- idempotencyGuard(repo)
      started <- Deferred[IO, Unit]
      first <- IdempotencyReplay.wrap[IO, Json, Json](
        guard,
        Some("key-in-flight"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:00Z")),
        started.complete(()) *> IO.never,
      ).start
      _ <- started.get
      second <- IdempotencyReplay.wrap[IO, Json, Json](
        guard,
        Some("key-in-flight"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:01Z")),
        IO.pure(Right(Json.obj("ok" -> Json.fromBoolean(true)))),
      )
      _ <- first.cancel
    yield second match
      case Left((status, problem)) =>
        assertEquals(status, sttp.model.StatusCode.Conflict)
        assertEquals(problem.code, "IDEMPOTENCY_IN_PROGRESS")
      case Right(value) => fail(s"expected in-progress problem, got replay: $value")
  }

  test("idempotency: raised mutation errors abandon the reservation for retries") {
    val account = AuthenticatedAccount(
      accountId = AccountId.unsafeFromString("account_ponta"),
      displayName = "ponta",
      isAdmin = true,
      playerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    )
    val request = Json.obj("value" -> Json.fromString("same"))
    val ok = Json.obj("ok" -> Json.fromBoolean(true))
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      guard <- idempotencyGuard(repo)
      attempts <- Ref.of[IO, Int](0)
      first <- IdempotencyReplay.wrap[IO, Json, Json](
        guard,
        Some("key-failed-mutation"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:00Z")),
        attempts.update(_ + 1) *>
          IO.raiseError[Either[ProblemDetails.ProblemResponse, Json]](RuntimeException("boom")),
      ).attempt
      second <- IdempotencyReplay.wrap[IO, Json, Json](
        guard,
        Some("key-failed-mutation"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:01Z")),
        attempts.update(_ + 1) *> IO.pure(Right(ok)),
      )
      attemptCount <- attempts.get
    yield
      assert(first.isLeft, s"expected first mutation to raise, got $first")
      assertEquals(second, Right(ok))
      assertEquals(attemptCount, 2)
  }

  test("idempotency: undecodable stored replay returns an internal problem") {
    val account = AuthenticatedAccount(
      accountId = AccountId.unsafeFromString("account_ponta"),
      displayName = "ponta",
      isAdmin = true,
      playerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    )
    val request = Json.obj("value" -> Json.fromString("same"))
    val stored = Json.obj("ok" -> Json.fromBoolean(true))
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      guard <- idempotencyGuard(repo)
      first <- IdempotencyReplay.wrap[IO, Json, Json](
        guard,
        Some("key-undecodable-replay"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:00Z")),
        IO.pure(Right(stored)),
      )
      second <- IdempotencyReplay.wrap[IO, Json, Int](
        guard,
        Some("key-undecodable-replay"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:01Z")),
        IO.raiseError[Either[ProblemDetails.ProblemResponse, Int]](RuntimeException(
          "replay should not run the mutation"
        )),
      )
    yield
      assertEquals(first, Right(stored))
      second match
        case Left((status, problem)) =>
          assertEquals(status, sttp.model.StatusCode.InternalServerError)
          assertEquals(problem.code, "INTERNAL_ERROR")
        case Right(value) => fail(s"expected stored response decode failure, got replay: $value")
  }

  app.test("idempotency: different keys produce two separate entities") { httpApp =>
    for
      first <- httpApp.run(heldEventReq(Some("key-3a"), "2024-04-01T00:00:00Z"))
      _ = assertEquals(first.status, Status.Ok)
      firstBody <- first.as[Json]
      second <- httpApp.run(heldEventReq(Some("key-3b"), "2024-04-02T00:00:00Z"))
      _ = assertEquals(second.status, Status.Ok)
      secondBody <- second.as[Json]
      listRes <- httpApp
        .run(Request[IO](Method.GET, uri"/api/held-events?limit=50").putHeaders(devReadHeader()))
      listBody <- listRes.as[Json]
    yield
      val createdIds = Set(jsonField[String](firstBody, "id"), jsonField[String](secondBody, "id"))
      val items = jsonField[List[Json]](listBody, "items")
      assertEquals(items.size, 2)
      assertEquals(items.map(jsonField[String](_, "id")).toSet, createdIds)
  }

  app.test("idempotency: delete endpoints replay terminal success instead of re-running") {
    httpApp =>
      for
        created <- httpApp.run(heldEventReq(None, "2024-04-03T00:00:00Z"))
        _ = assertEquals(created.status, Status.Ok)
        createdBody <- created.as[Json]
        heldEventId = jsonField[String](createdBody, "id")
        first <- httpApp.run(deleteHeldEventReq(Some("key-delete-held-event"), heldEventId))
        firstBody <- first.as[Json]
        second <- httpApp.run(deleteHeldEventReq(Some("key-delete-held-event"), heldEventId))
        secondBody <- second.as[Json]
      yield
        assertEquals(first.status, Status.Ok)
        assertEquals(second.status, Status.Ok)
        assertEquals(firstBody, secondBody)
  }

  app.test("idempotency: same path mutation key with a different id returns 409") { httpApp =>
    for
      draft1 <- httpApp.run(createMatchDraftReq)
      _ = assertEquals(draft1.status, Status.Ok)
      draft1Body <- draft1.as[Json]
      draft2 <- httpApp.run(createMatchDraftReq)
      _ = assertEquals(draft2.status, Status.Ok)
      draft2Body <- draft2.as[Json]
      draft1Id = jsonField[String](draft1Body, "matchDraftId")
      draft2Id = jsonField[String](draft2Body, "matchDraftId")
      firstCancel <- httpApp.run(cancelMatchDraftReq(Some("key-cancel-draft"), draft1Id))
      _ = assertEquals(firstCancel.status, Status.Ok)
      secondCancel <- httpApp.run(cancelMatchDraftReq(Some("key-cancel-draft"), draft2Id))
      _ <- assertProblem(
        secondCancel,
        Status.Conflict,
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
        "Idempotency-Key",
      )
      draft2Get <- httpApp.run(
        Request[IO](Method.GET, Uri.unsafeFromString(s"/api/match-drafts/$draft2Id"))
          .putHeaders(devReadHeader())
      )
      draft2GetBody <- draft2Get.as[Json]
    yield assertEquals(jsonField[String](draft2GetBody, "status"), "draft_ready")
  }

  app.test("idempotency: missing key still works (creates entity normally)") { httpApp =>
    for
      first <- httpApp.run(heldEventReq(None, "2024-05-01T00:00:00Z"))
      _ = assertEquals(first.status, Status.Ok)
      second <- httpApp.run(heldEventReq(None, "2024-05-01T00:00:00Z"))
    yield assertEquals(second.status, Status.Ok)
  }

  app.test("idempotency: invalid key characters are rejected before side effects") { httpApp =>
    httpApp.run(heldEventReq(Some("bad key"), "2024-06-01T00:00:00Z")).flatMap { response =>
      assertProblem(response, Status.UnprocessableContent, "VALIDATION_FAILED", "Idempotency-Key")
    }
  }

  app.test("idempotency: keys longer than 128 characters are rejected") { httpApp =>
    httpApp.run(heldEventReq(Some("a" * 129), "2024-07-01T00:00:00Z")).flatMap { response =>
      assertProblem(response, Status.UnprocessableContent, "VALIDATION_FAILED", "Idempotency-Key")
    }
  }
