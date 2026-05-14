package momo.api.http

import cats.effect.{Deferred, IO}
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status, Uri}

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.InMemoryIdempotencyRepository
import momo.api.auth.AuthenticatedAccount
import momo.api.domain.ids.{AccountId, MemberId}
import momo.api.http.HttpAssertions.{assertProblem, jsonField}

final class IdempotencyIntegrationSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:

  private val app = ResourceFunFixture(wiredHttpAppResource("momo-api-idempotency"))

  private def heldEventReq(idemKey: Option[String], heldAt: String): Request[IO] =
    Request[IO](Method.POST, uri"/api/held-events")
      .putHeaders(devWriteHeadersWithIdempotency(idemKey)*)
      .withEntity(HttpRequestBodies.Matches.createHeldEvent(heldAt))

  private def deleteHeldEventReq(idemKey: Option[String], heldEventId: String): Request[IO] =
    Request[IO](Method.DELETE, Uri.unsafeFromString(s"/api/held-events/$heldEventId"))
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
      started <- Deferred[IO, Unit]
      first <- IdempotencyReplay.wrap[IO, Json, Json](
        repo,
        Some("key-in-flight"),
        account,
        "POST /api/testing/idempotency",
        request,
        IO.pure(java.time.Instant.parse("2026-05-14T00:00:00Z")),
        started.complete(()) *> IO.never,
      ).start
      _ <- started.get
      second <- IdempotencyReplay.wrap[IO, Json, Json](
        repo,
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
