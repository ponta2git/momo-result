package momo.api.http

import java.time.Instant

import cats.effect.IO
import io.circe.Json
import org.http4s.circe.*
import org.http4s.circe.CirceEntityCodec.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status}

import momo.api.MomoCatsEffectSuite
import momo.api.endpoints.{
  GameTitleListResponse, GameTitleResponse, IncidentMasterListResponse, IncidentMasterResponse,
  MapMasterListResponse, MapMasterResponse, SeasonMasterListResponse, SeasonMasterResponse,
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
    val req = Request[IO](Method.GET, uri"/api/incident-masters").withHeaders(devReadHeader())
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
    val create = Request[IO](Method.POST, uri"/api/game-titles").withHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Master.gameTitleWorld)
    val list = Request[IO](Method.GET, uri"/api/game-titles").withHeaders(devReadHeader())
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
    val req = Request[IO](Method.POST, uri"/api/game-titles").withHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Master.createGameTitle("Title-World", "x", "world"))
    http.run(req).flatMap { r =>
      assertProblem(r, Status.UnprocessableContent, "VALIDATION_FAILED", "id must match")
    }
  }

  app.test("POST /api/map-masters and /api/season-masters happy path with display order") { http =>
    def post(path: String, body: Json) = http.run(
      Request[IO](Method.POST, org.http4s.Uri.unsafeFromString(path))
        .withHeaders(devWriteHeaders()*).withEntity(body)
    )

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
      listedMaps <- http.run(
        Request[IO](Method.GET, uri"/api/map-masters?gameTitleId=title_world")
          .withHeaders(devReadHeader())
      )
      _ = assertEquals(listedMaps.status, Status.Ok)
      mapList <- listedMaps.as[MapMasterListResponse]
      _ = assertEquals(mapList.items, List(createdMap1, createdMap2))
      listedSeasons <- http.run(
        Request[IO](Method.GET, uri"/api/season-masters?gameTitleId=title_world")
          .withHeaders(devReadHeader())
      )
      _ = assertEquals(listedSeasons.status, Status.Ok)
      seasonList <- listedSeasons.as[SeasonMasterListResponse]
      _ = assertEquals(seasonList.items, List(createdSeason))
    yield ()
  }

  app.test("POST /api/game-titles without CSRF token is rejected") { http =>
    val req = Request[IO](Method.POST, uri"/api/game-titles").withHeaders(devReadHeader())
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
