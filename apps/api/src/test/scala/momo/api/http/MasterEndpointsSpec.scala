package momo.api.http

import cats.effect.{IO, Resource}
import io.circe.Json
import java.nio.file.Files
import momo.api.config.{AppConfig, AppEnv}
import momo.api.MomoCatsEffectSuite
import org.http4s.{Header, Method, Request, Status}
import org.http4s.circe.*
import org.http4s.implicits.*
import org.typelevel.ci.CIString

final class MasterEndpointsSpec extends MomoCatsEffectSuite:

  private def app: Resource[IO, org.http4s.HttpApp[IO]] = Resource
    .eval(IO.blocking(Files.createTempDirectory("momo-api-master"))).flatMap { dir =>
      val config = AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
      )
      HttpApp.resource[IO](config)
    }

  private def authHeaders: List[Header.ToRaw] = List[Header.ToRaw](
    Header.Raw(CIString("X-Dev-User"), "ponta"),
    Header.Raw(CIString("X-CSRF-Token"), "dev"),
  )

  private def readHeader = Header.Raw(CIString("X-Dev-User"), "ponta")

  test("GET /api/incident-masters returns 6 fixed incidents") {
    app.use { http =>
      val req = Request[IO](Method.GET, uri"/api/incident-masters").withHeaders(readHeader)
      http.run(req).flatMap { resp =>
        assertEquals(resp.status, Status.Ok)
        resp.as[Json].map { json =>
          val items = json.hcursor.downField("items").values.toList.flatMap(_.toList)
          assertEquals(items.size, 6)
          val ids = items.flatMap(_.hcursor.downField("id").as[String].toOption).toSet
          assertEquals(
            ids,
            Set(
              "incident_destination",
              "incident_plus_station",
              "incident_minus_station",
              "incident_card_station",
              "incident_card_shop",
              "incident_suri_no_ginji",
            ),
          )
        }
      }
    }
  }

  test("POST /api/game-titles creates a title and lists it") {
    app.use { http =>
      val body = Json.obj(
        "id" -> Json.fromString("title_world"),
        "name" -> Json.fromString("桃太郎電鉄ワールド"),
        "layoutFamily" -> Json.fromString("world"),
      )
      val create = Request[IO](Method.POST, uri"/api/game-titles").withHeaders(authHeaders*)
        .withEntity(body)
      val list = Request[IO](Method.GET, uri"/api/game-titles").withHeaders(readHeader)
      for
        c <- http.run(create)
        _ = assertEquals(c.status, Status.Ok)
        cj <- c.as[Json]
        _ = assertEquals(cj.hcursor.downField("id").as[String].toOption, Some("title_world"))
        _ = assertEquals(cj.hcursor.downField("displayOrder").as[Int].toOption, Some(1))
        l <- http.run(list)
        _ = assertEquals(l.status, Status.Ok)
        lj <- l.as[Json]
        items = lj.hcursor.downField("items").values.toList.flatMap(_.toList)
        _ = assertEquals(items.size, 1)
      yield ()
    }
  }

  test("POST /api/game-titles rejects invalid id") {
    app.use { http =>
      val body = Json.obj(
        "id" -> Json.fromString("Title-World"),
        "name" -> Json.fromString("x"),
        "layoutFamily" -> Json.fromString("world"),
      )
      val req = Request[IO](Method.POST, uri"/api/game-titles").withHeaders(authHeaders*)
        .withEntity(body)
      http.run(req).map(r => assertEquals(r.status, Status.UnprocessableContent))
    }
  }

  test("POST /api/game-titles returns 409 on duplicate id") {
    app.use { http =>
      val body = Json.obj(
        "id" -> Json.fromString("title_world"),
        "name" -> Json.fromString("ワールド"),
        "layoutFamily" -> Json.fromString("world"),
      )
      val req = Request[IO](Method.POST, uri"/api/game-titles").withHeaders(authHeaders*)
        .withEntity(body)
      for
        first <- http.run(req)
        _ = assertEquals(first.status, Status.Ok)
        second <- http.run(req)
        _ = assertEquals(second.status, Status.Conflict)
      yield ()
    }
  }

  test("POST /api/map-masters requires existing game title") {
    app.use { http =>
      val body = Json.obj(
        "id" -> Json.fromString("map_east"),
        "gameTitleId" -> Json.fromString("title_missing"),
        "name" -> Json.fromString("東日本編"),
      )
      val req = Request[IO](Method.POST, uri"/api/map-masters").withHeaders(authHeaders*)
        .withEntity(body)
      http.run(req).map(r => assertEquals(r.status, Status.NotFound))
    }
  }

  test("POST /api/map-masters and /api/season-masters happy path with display order") {
    app.use { http =>
      def post(path: String, body: Json) = http.run(
        Request[IO](Method.POST, org.http4s.Uri.unsafeFromString(path)).withHeaders(authHeaders*)
          .withEntity(body)
      )

      val titleBody = Json.obj(
        "id" -> Json.fromString("title_world"),
        "name" -> Json.fromString("ワールド"),
        "layoutFamily" -> Json.fromString("world"),
      )
      val map1 = Json.obj(
        "id" -> Json.fromString("map_east"),
        "gameTitleId" -> Json.fromString("title_world"),
        "name" -> Json.fromString("東日本編"),
      )
      val map2 = Json.obj(
        "id" -> Json.fromString("map_west"),
        "gameTitleId" -> Json.fromString("title_world"),
        "name" -> Json.fromString("西日本編"),
      )
      val season = Json.obj(
        "id" -> Json.fromString("season_2024_spring"),
        "gameTitleId" -> Json.fromString("title_world"),
        "name" -> Json.fromString("2024春"),
      )
      for
        _ <- post("/api/game-titles", titleBody).flatMap(r => IO(assertEquals(r.status, Status.Ok)))
        _ <- post("/api/map-masters", map1).flatMap { r =>
          assertEquals(r.status, Status.Ok)
          r.as[Json]
            .map(j => assertEquals(j.hcursor.downField("displayOrder").as[Int].toOption, Some(1)))
        }
        _ <- post("/api/map-masters", map2).flatMap { r =>
          assertEquals(r.status, Status.Ok)
          r.as[Json]
            .map(j => assertEquals(j.hcursor.downField("displayOrder").as[Int].toOption, Some(2)))
        }
        _ <- post("/api/season-masters", season).flatMap(r => IO(assertEquals(r.status, Status.Ok)))
        // filtered listing
        listed <- http.run(
          Request[IO](Method.GET, uri"/api/map-masters?gameTitleId=title_world")
            .withHeaders(readHeader)
        )
        _ = assertEquals(listed.status, Status.Ok)
        lj <- listed.as[Json]
        items = lj.hcursor.downField("items").values.toList.flatMap(_.toList)
        _ = assertEquals(items.size, 2)
      yield ()
    }
  }

  test("POST /api/game-titles without CSRF token is rejected") {
    app.use { http =>
      val body = Json.obj(
        "id" -> Json.fromString("title_world"),
        "name" -> Json.fromString("x"),
        "layoutFamily" -> Json.fromString("world"),
      )
      val req = Request[IO](Method.POST, uri"/api/game-titles")
        .withHeaders(Header.Raw(CIString("X-Dev-User"), "ponta")).withEntity(body)
      http.run(req).map(r => assertEquals(r.status, Status.Forbidden))
    }
  }

  test("GET /api/game-titles without auth returns 401") {
    app.use { http =>
      val req = Request[IO](Method.GET, uri"/api/game-titles")
      http.run(req).map(r => assertEquals(r.status, Status.Unauthorized))
    }
  }
