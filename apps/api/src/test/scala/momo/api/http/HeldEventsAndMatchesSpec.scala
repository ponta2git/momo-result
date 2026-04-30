package momo.api.http

import cats.effect.IO
import cats.effect.Resource
import io.circe.Json
import momo.api.MomoCatsEffectSuite
import momo.api.config.AppConfig
import momo.api.config.AppEnv
import org.http4s.Header
import org.http4s.Method
import org.http4s.Request
import org.http4s.Status
import org.http4s.circe.*
import org.http4s.implicits.*
import org.typelevel.ci.CIString

import java.nio.file.Files

final class HeldEventsAndMatchesSpec extends MomoCatsEffectSuite:
  import cats.effect.unsafe.implicits.global as _
  import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}
  import java.time.Instant

  private def app: Resource[IO, org.http4s.HttpApp[IO]] =
    Resource.eval(IO.blocking(Files.createTempDirectory("momo-api-held"))).flatMap { dir =>
      val config = AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("ponta", "akane-mami", "otaka", "eu")
      )
      HttpApp.wired[IO](config).evalTap { w =>
        val now = Instant.parse("2024-01-01T00:00:00Z")
        for
          _ <- w.gameTitles.create(GameTitle("title_world", "桃太郎電鉄ワールド", "world", 1, now))
          _ <- w.mapMasters.create(MapMaster("map_east", "title_world", "東日本編", 1, now))
          _ <- w.seasonMasters.create(SeasonMaster("season_2024_spring", "title_world", "2024-spring", 1, now))
        yield ()
      }.map(_.app)
    }

  private def authHeaders: List[Header.ToRaw] =
    List[Header.ToRaw](
      Header.Raw(CIString("X-Dev-User"), "ponta"),
      Header.Raw(CIString("X-CSRF-Token"), "dev")
    )

  private def readHeader = Header.Raw(CIString("X-Dev-User"), "ponta")

  private def incidents =
    Json.obj(
      "destination" -> Json.fromInt(1),
      "plusStation" -> Json.fromInt(0),
      "minusStation" -> Json.fromInt(0),
      "cardStation" -> Json.fromInt(0),
      "cardShop" -> Json.fromInt(0),
      "suriNoGinji" -> Json.fromInt(0)
    )

  private def player(memberId: String, playOrder: Int, rank: Int): Json =
    Json.obj(
      "memberId" -> Json.fromString(memberId),
      "playOrder" -> Json.fromInt(playOrder),
      "rank" -> Json.fromInt(rank),
      "totalAssetsManYen" -> Json.fromInt(100),
      "revenueManYen" -> Json.fromInt(50),
      "incidents" -> incidents
    )

  test("POST /api/held-events creates event and lists it") {
    app.use { httpApp =>
      val createReq = Request[IO](Method.POST, uri"/api/held-events")
        .putHeaders(authHeaders*)
        .withEntity(
          Json.obj(
            "heldAt" -> Json.fromString("2024-01-01T00:00:00Z")
          )
        )
      for
        createRes <- httpApp.run(createReq)
        _ = assertEquals(createRes.status, Status.Ok)
        body <- createRes.as[Json]
        id = body.hcursor.get[String]("id").toOption.get
        listRes <- httpApp.run(
          Request[IO](Method.GET, uri"/api/held-events").putHeaders(readHeader)
        )
        _ = assertEquals(listRes.status, Status.Ok)
        listBody <- listRes.as[Json]
        items = listBody.hcursor.get[List[Json]]("items").toOption.get
      yield
        assertEquals(items.size, 1)
        assertEquals(items.head.hcursor.get[String]("id"), Right(id))
    }
  }

  test("POST /api/held-events with invalid heldAt returns 422") {
    app.use { httpApp =>
      val req = Request[IO](Method.POST, uri"/api/held-events")
        .putHeaders(authHeaders*)
        .withEntity(
          Json.obj(
            "heldAt" -> Json.fromString("not-an-instant")
          )
        )
      httpApp.run(req).map { res =>
        assertEquals(res.status, Status.UnprocessableEntity)
      }
    }
  }

  test("GET /api/ocr-drafts bulk rejects empty ids") {
    app.use { httpApp =>
      httpApp
        .run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=").putHeaders(readHeader))
        .map { res =>
          assertEquals(res.status, Status.UnprocessableEntity)
        }
    }
  }

  test("GET /api/ocr-drafts bulk returns 404 when a draft is missing") {
    app.use { httpApp =>
      httpApp
        .run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=missing").putHeaders(readHeader))
        .map { res =>
          assertEquals(res.status, Status.NotFound)
        }
    }
  }

  private def confirmBody(heldEventId: String, matchNo: Int = 1): Json =
    Json.obj(
      "heldEventId" -> Json.fromString(heldEventId),
      "matchNoInEvent" -> Json.fromInt(matchNo),
      "gameTitleId" -> Json.fromString("title_world"),
      "seasonMasterId" -> Json.fromString("season_2024_spring"),
      "ownerMemberId" -> Json.fromString("ponta"),
      "mapMasterId" -> Json.fromString("map_east"),
      "playedAt" -> Json.fromString("2024-01-01T20:00:00Z"),
      "draftIds" -> Json.obj(
        "totalAssets" -> Json.Null,
        "revenue" -> Json.Null,
        "incidentLog" -> Json.Null
      ),
      "players" -> Json.arr(
        player("ponta", 1, 1),
        player("akane-mami", 2, 2),
        player("otaka", 3, 3),
        player("eu", 4, 4)
      )
    )

  private def createEvent(httpApp: org.http4s.HttpApp[IO]): IO[String] =
    httpApp
      .run(
        Request[IO](Method.POST, uri"/api/held-events")
          .putHeaders(authHeaders*)
          .withEntity(
            Json.obj(
              "heldAt" -> Json.fromString("2024-01-01T00:00:00Z")
            )
          )
      )
      .flatMap(_.as[Json])
      .map(_.hcursor.get[String]("id").toOption.get)

  test("POST /api/matches confirms with valid body") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        res <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches")
            .putHeaders(authHeaders*)
            .withEntity(confirmBody(id))
        )
        body <- res.as[Json]
      yield
        assertEquals(res.status, Status.Ok)
        assertEquals(body.hcursor.get[String]("heldEventId"), Right(id))
        assertEquals(body.hcursor.get[Int]("matchNoInEvent"), Right(1))
    }
  }

  test("POST /api/matches rejects duplicate ranks") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        body = confirmBody(id).hcursor
          .downField("players")
          .withFocus(_ =>
            Json.arr(
              player("ponta", 1, 1),
              player("akane-mami", 2, 1),
              player("otaka", 3, 3),
              player("eu", 4, 4)
            )
          )
          .top
          .get
        res <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches")
            .putHeaders(authHeaders*)
            .withEntity(body)
        )
      yield assertEquals(res.status, Status.UnprocessableEntity)
    }
  }

  test("POST /api/matches rejects missing held event") {
    app.use { httpApp =>
      val res = httpApp.run(
        Request[IO](Method.POST, uri"/api/matches")
          .putHeaders(authHeaders*)
          .withEntity(confirmBody("does-not-exist"))
      )
      res.map(r => assertEquals(r.status, Status.NotFound))
    }
  }

  test("POST /api/matches rejects duplicate matchNo") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        first <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches")
            .putHeaders(authHeaders*)
            .withEntity(confirmBody(id, 1))
        )
        _ = assertEquals(first.status, Status.Ok)
        _ <- first.as[Json]
        second <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches")
            .putHeaders(authHeaders*)
            .withEntity(confirmBody(id, 1))
        )
      yield assertEquals(second.status, Status.Conflict)
    }
  }
