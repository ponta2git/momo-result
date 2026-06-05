package momo.api.http

import java.time.Instant

import cats.effect.IO
import io.circe.Json
import org.http4s.circe.*
import org.http4s.circe.CirceEntityCodec.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status, Uri}

import momo.api.MomoCatsEffectSuite
import momo.api.endpoints.{
  GameTitleListResponse, GameTitleResponse, IncidentMasterListResponse, IncidentMasterResponse,
  MapMasterListResponse, MapMasterResponse, MemberAliasListResponse, MemberAliasResponse,
  SeasonMasterListResponse, SeasonMasterResponse,
}
import momo.api.http.HttpAssertions.{assertProblem, assertProblemDetailEquals}

final class MasterEndpointsSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:

  private val app = ResourceFunFixture(httpAppResource("momo-api-master"))

  private def assertIsoInstant(value: String): Unit =
    assertEquals(Instant.parse(value).toString, value)

  private def assertGameTitle(
      actual: GameTitleResponse,
      expectedWithoutCreatedAt: GameTitleResponse,
  ): Unit =
    assertIsoInstant(actual.createdAt)
    assertEquals(actual.copy(createdAt = ""), expectedWithoutCreatedAt.copy(createdAt = ""))

  private def assertMapMaster(
      actual: MapMasterResponse,
      expectedWithoutCreatedAt: MapMasterResponse,
  ): Unit =
    assertIsoInstant(actual.createdAt)
    assertEquals(actual.copy(createdAt = ""), expectedWithoutCreatedAt.copy(createdAt = ""))

  private def assertSeasonMaster(
      actual: SeasonMasterResponse,
      expectedWithoutCreatedAt: SeasonMasterResponse,
  ): Unit =
    assertIsoInstant(actual.createdAt)
    assertEquals(actual.copy(createdAt = ""), expectedWithoutCreatedAt.copy(createdAt = ""))

  app.test("GET /api/incident-masters returns 6 fixed incidents") { http =>
    val req = readGet(uri"/api/incident-masters")
    http.run(req).flatMap { resp =>
      assertEquals(resp.status, Status.Ok)
      resp.as[IncidentMasterListResponse].map { body =>
        assertEquals(
          body.items,
          List(
            IncidentMasterResponse("incident_destination", "destination", "目的地", 1),
            IncidentMasterResponse("incident_plus_station", "plus_station", "プラス駅", 2),
            IncidentMasterResponse("incident_minus_station", "minus_station", "マイナス駅", 3),
            IncidentMasterResponse("incident_card_station", "card_station", "カード駅", 4),
            IncidentMasterResponse("incident_card_shop", "card_shop", "カード売り場", 5),
            IncidentMasterResponse("incident_suri_no_ginji", "suri_no_ginji", "スリの銀次", 6),
          ),
        )
      }
    }
  }

  app.test("POST /api/game-titles creates a title and lists it") { http =>
    val create = writePost(uri"/api/game-titles", HttpRequestBodies.Master.gameTitleWorld)
    val list = readGet(uri"/api/game-titles")
    for
      c <- http.run(create)
      _ = assertEquals(c.status, Status.Ok)
      created <- c.as[GameTitleResponse]
      _ = assertGameTitle(created, GameTitleResponse("title_world", "桃太郎電鉄ワールド", "world", 1, ""))
      l <- http.run(list)
      _ = assertEquals(l.status, Status.Ok)
      listed <- l.as[GameTitleListResponse]
      _ = assertEquals(listed.items, List(created))
    yield ()
  }

  app.test("POST /api/game-titles rejects invalid id") { http =>
    val req = writePost(
      uri"/api/game-titles",
      HttpRequestBodies.Master.createGameTitle("Title-World", "x", "world"),
    )
    http.run(req).flatMap { r =>
      assertProblem(r, Status.UnprocessableContent, "VALIDATION_FAILED", "id must match")
    }
  }

  app.test("POST /api/game-titles rejects blank id at the HTTP boundary") { http =>
    val req =
      writePost(uri"/api/game-titles", HttpRequestBodies.Master.createGameTitle(" ", "x", "world"))
    http.run(req).flatMap { r =>
      assertProblem(r, Status.UnprocessableContent, "VALIDATION_FAILED", "id must not be blank")
    }
  }

  app.test("POST /api/game-titles is restricted to administrators") { http =>
    val req = writePost(
      uri"/api/game-titles",
      HttpRequestBodies.Master.gameTitleWorld,
      accountId = "account_eu",
    )
    http.run(req).flatMap { r =>
      assertProblemDetailEquals(
        r,
        Status.Forbidden,
        "FORBIDDEN",
        "Administrator access is required.",
      )
    }
  }

  app.test("PATCH and DELETE /api/game-titles update and remove an unused title") { http =>
    val create = writePost(uri"/api/game-titles", HttpRequestBodies.Master.gameTitleWorld)
    val patch = writePatch(
      uri"/api/game-titles/title_world",
      Json.obj("name" -> Json.fromString("桃太郎電鉄ワールドDX"), "layoutFamily" -> Json.fromString("world")),
    )
    val delete = writeDelete(uri"/api/game-titles/title_world")
    val list = readGet(uri"/api/game-titles")
    for
      created <- http.run(create)
      _ = assertEquals(created.status, Status.Ok)
      updated <- http.run(patch)
      _ = assertEquals(updated.status, Status.Ok)
      body <- updated.as[GameTitleResponse]
      _ = assertEquals(body.name, "桃太郎電鉄ワールドDX")
      deleted <- http.run(delete)
      _ = assertEquals(deleted.status, Status.Ok)
      listed <- http.run(list)
      items <- listed.as[GameTitleListResponse]
      _ = assertEquals(items.items, Nil)
    yield ()
  }

  app.test("POST /api/map-masters and /api/season-masters happy path with display order") { http =>
    def post(path: String, body: Json) = http.run(writePost(Uri.unsafeFromString(path), body))

    val titleBody = HttpRequestBodies.Master.createGameTitle("title_world", "ワールド", "world")
    val map1 = HttpRequestBodies.Master.createMapMaster("map_east", "東日本編")
    val map2 = HttpRequestBodies.Master.createMapMaster("map_west", "西日本編")
    val season = HttpRequestBodies.Master.createSeasonMaster("season_2024_spring", "2024春")
    for
      _ <- post("/api/game-titles", titleBody).flatMap(r => IO(assertEquals(r.status, Status.Ok)))
      createdMap1 <- post("/api/map-masters", map1).flatMap { r =>
        assertEquals(r.status, Status.Ok)
        r.as[MapMasterResponse]
      }
      _ = assertMapMaster(createdMap1, MapMasterResponse("map_east", "title_world", "東日本編", 1, ""))
      createdMap2 <- post("/api/map-masters", map2).flatMap { r =>
        assertEquals(r.status, Status.Ok)
        r.as[MapMasterResponse]
      }
      _ = assertMapMaster(createdMap2, MapMasterResponse("map_west", "title_world", "西日本編", 2, ""))
      createdSeason <- post("/api/season-masters", season).flatMap { r =>
        assertEquals(r.status, Status.Ok)
        r.as[SeasonMasterResponse]
      }
      _ = assertSeasonMaster(
        createdSeason,
        SeasonMasterResponse("season_2024_spring", "title_world", "2024春", 1, ""),
      )
      listedMaps <- http.run(readGet(uri"/api/map-masters?gameTitleId=title_world"))
      _ = assertEquals(listedMaps.status, Status.Ok)
      mapList <- listedMaps.as[MapMasterListResponse]
      _ = assertEquals(mapList.items, List(createdMap1, createdMap2))
      listedSeasons <- http.run(readGet(uri"/api/season-masters?gameTitleId=title_world"))
      _ = assertEquals(listedSeasons.status, Status.Ok)
      seasonList <- listedSeasons.as[SeasonMasterListResponse]
      _ = assertEquals(seasonList.items, List(createdSeason))
    yield ()
  }

  app.test("GET /api/map-masters rejects blank game title filter at the HTTP boundary") { http =>
    val req = readGet(uri"/api/map-masters?gameTitleId=%20")
    http.run(req).flatMap { r =>
      assertProblem(r, Status.UnprocessableContent, "VALIDATION_FAILED", "gameTitleId")
    }
  }

  app.test("POST /api/game-titles without CSRF token is rejected") { http =>
    val req = readRequest(Method.POST, uri"/api/game-titles")
      .withEntity(HttpRequestBodies.Master.createGameTitle("title_world", "x", "world"))
    http.run(req).flatMap(r =>
      assertProblemDetailEquals(
        r,
        Status.Forbidden,
        "FORBIDDEN",
        "Development CSRF token is required. Use X-CSRF-Token: dev.",
      )
    )
  }

  app.test("member alias CRUD lists, creates, updates, and deletes aliases") { http =>
    def writeReq(method: Method, path: String, body: Option[Json]): Request[IO] =
      val base = writeRequest(method, Uri.unsafeFromString(path))
      body.fold(base)(base.withEntity)

    val createBody = Json
      .obj("memberId" -> Json.fromString("member_akane_mami"), "alias" -> Json.fromString("NO11社長"))
    val updateBody = Json
      .obj("memberId" -> Json.fromString("member_otaka"), "alias" -> Json.fromString("オータカ社長"))
    for
      createdResp <- http.run(writeReq(Method.POST, "/api/member-aliases", Some(createBody)))
      _ = assertEquals(createdResp.status, Status.Ok)
      created <- createdResp.as[MemberAliasResponse]
      _ = assertEquals(created.memberId, "member_akane_mami")
      listedResp <- http.run(readGet(uri"/api/member-aliases"))
      _ = assertEquals(listedResp.status, Status.Ok)
      listed <- listedResp.as[MemberAliasListResponse]
      _ = assertEquals(listed.items.map(_.alias), List("NO11社長"))
      updatedResp <- http
        .run(writeReq(Method.PATCH, s"/api/member-aliases/${created.id}", Some(updateBody)))
      _ = assertEquals(updatedResp.status, Status.Ok)
      updated <- updatedResp.as[MemberAliasResponse]
      _ = assertEquals(updated.memberId, "member_otaka")
      _ = assertEquals(updated.alias, "オータカ社長")
      deletedResp <- http.run(writeReq(Method.DELETE, s"/api/member-aliases/${created.id}", None))
      _ = assertEquals(deletedResp.status, Status.Ok)
      emptyResp <- http.run(readGet(uri"/api/member-aliases"))
      empty <- emptyResp.as[MemberAliasListResponse]
      _ = assertEquals(empty.items, Nil)
    yield ()
  }

  app.test("member alias endpoints reject blank member ids at the HTTP boundary") { http =>
    val createBody = Json.obj("memberId" -> Json.fromString(" "), "alias" -> Json.fromString("x"))
    for
      createResp <- http.run(writePost(uri"/api/member-aliases", createBody))
      _ <- assertProblem(createResp, Status.UnprocessableContent, "VALIDATION_FAILED", "memberId")
      listResp <- http.run(readGet(uri"/api/member-aliases?memberId=%20"))
      _ <- assertProblem(listResp, Status.UnprocessableContent, "VALIDATION_FAILED", "memberId")
    yield ()
  }

  app.test("GET /api/game-titles without auth returns 401") { http =>
    val req = Request[IO](Method.GET, uri"/api/game-titles")
    http.run(req).flatMap { r =>
      assertProblemDetailEquals(
        r,
        Status.Unauthorized,
        "UNAUTHORIZED",
        "Authentication is required.",
      )
    }
  }
