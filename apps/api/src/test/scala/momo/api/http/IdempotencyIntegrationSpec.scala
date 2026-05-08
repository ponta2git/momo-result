package momo.api.http

import cats.effect.IO
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status}

import momo.api.MomoCatsEffectSuite
import momo.api.http.HttpAssertions.{assertProblem, jsonField}

final class IdempotencyIntegrationSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:

  private val app = ResourceFunFixture(wiredHttpAppResource("momo-api-idempotency"))

  private def heldEventReq(idemKey: Option[String], heldAt: String): Request[IO] =
    Request[IO](Method.POST, uri"/api/held-events")
      .putHeaders(devWriteHeadersWithIdempotency(idemKey)*)
      .withEntity(HttpRequestBodies.Matches.createHeldEvent(heldAt))

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
      _ <- assertProblem(second, Status.Conflict, "CONFLICT", "Idempotency-Key")
    yield ()
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

  app.test("idempotency: missing key still works (creates entity normally)") { httpApp =>
    for
      first <- httpApp.run(heldEventReq(None, "2024-05-01T00:00:00Z"))
      _ = assertEquals(first.status, Status.Ok)
      second <- httpApp.run(heldEventReq(None, "2024-05-01T00:00:00Z"))
    yield assertEquals(second.status, Status.Ok)
  }
