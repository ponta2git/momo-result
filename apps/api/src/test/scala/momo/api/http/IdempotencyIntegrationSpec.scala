package momo.api.http

import java.nio.file.Files

import cats.effect.{IO, Resource}
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Header, Method, Request, Status}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv}

final class IdempotencyIntegrationSpec extends MomoCatsEffectSuite:

  private def app: Resource[IO, org.http4s.HttpApp[IO]] = Resource
    .eval(IO.blocking(Files.createTempDirectory("momo-api-idempotency"))).flatMap { dir =>
      val config = AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
      )
      HttpApp.wired[IO](config).map(_.app)
    }

  private def authHeaders(idemKey: Option[String]): List[Header.ToRaw] =
    val base = List[Header.ToRaw](
      Header.Raw(CIString("X-Dev-User"), "ponta"),
      Header.Raw(CIString("X-CSRF-Token"), "dev"),
    )
    idemKey.fold(base)(k => base :+ (Header.Raw(CIString("Idempotency-Key"), k): Header.ToRaw))

  private def heldEventReq(idemKey: Option[String], heldAt: String): Request[IO] =
    Request[IO](Method.POST, uri"/api/held-events")
      .putHeaders(authHeaders(idemKey)*)
      .withEntity(Json.obj("heldAt" -> Json.fromString(heldAt)))

  test("idempotency: same key + same body replays response and skips side-effect") {
    app.use { httpApp =>
      for
        first <- httpApp.run(heldEventReq(Some("key-1"), "2024-01-01T00:00:00Z"))
        firstBody <- first.as[Json]
        second <- httpApp.run(heldEventReq(Some("key-1"), "2024-01-01T00:00:00Z"))
        secondBody <- second.as[Json]
        listRes <- httpApp.run(
          Request[IO](Method.GET, uri"/api/held-events?limit=50")
            .putHeaders(Header.Raw(CIString("X-Dev-User"), "ponta"))
        )
        listBody <- listRes.as[Json]
      yield
        assertEquals(first.status, Status.Ok)
        assertEquals(second.status, Status.Ok)
        assertEquals(firstBody, secondBody)
        val items = listBody.hcursor.downField("items").as[List[Json]].toOption.getOrElse(Nil)
        assertEquals(items.size, 1)
    }
  }

  test("idempotency: same key + different body returns 409 Conflict") {
    app.use { httpApp =>
      for
        first <- httpApp.run(heldEventReq(Some("key-2"), "2024-02-01T00:00:00Z"))
        _ = assertEquals(first.status, Status.Ok)
        second <- httpApp.run(heldEventReq(Some("key-2"), "2024-03-01T00:00:00Z"))
      yield assertEquals(second.status, Status.Conflict)
    }
  }

  test("idempotency: different keys produce two separate entities") {
    app.use { httpApp =>
      for
        first <- httpApp.run(heldEventReq(Some("key-3a"), "2024-04-01T00:00:00Z"))
        _ = assertEquals(first.status, Status.Ok)
        second <- httpApp.run(heldEventReq(Some("key-3b"), "2024-04-02T00:00:00Z"))
        _ = assertEquals(second.status, Status.Ok)
        listRes <- httpApp.run(
          Request[IO](Method.GET, uri"/api/held-events?limit=50")
            .putHeaders(Header.Raw(CIString("X-Dev-User"), "ponta"))
        )
        listBody <- listRes.as[Json]
      yield
        val items = listBody.hcursor.downField("items").as[List[Json]].toOption.getOrElse(Nil)
        assertEquals(items.size, 2)
    }
  }

  test("idempotency: missing key still works (creates entity normally)") {
    app.use { httpApp =>
      for
        first <- httpApp.run(heldEventReq(None, "2024-05-01T00:00:00Z"))
        _ = assertEquals(first.status, Status.Ok)
        second <- httpApp.run(heldEventReq(None, "2024-05-01T00:00:00Z"))
      yield assertEquals(second.status, Status.Ok)
    }
  }
