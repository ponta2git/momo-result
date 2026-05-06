package momo.api.http

import java.nio.file.Files

import cats.effect.{IO, Resource}
import fs2.Stream
import io.circe.Json
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.implicits.*
import org.http4s.multipart.{Multiparts, Part}
import org.http4s.{Header, MediaType, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv}
import momo.api.http.HttpAssertions.{assertProblem, headerValue, jsonField, optionalHeaderValue}

final class HeldEventsAndMatchesSpec extends MomoCatsEffectSuite:
  import java.time.Instant
  import momo.api.domain.ids.*
  import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}

  private def app: Resource[IO, org.http4s.HttpApp[IO]] = Resource
    .eval(IO.blocking(Files.createTempDirectory("momo-api-held"))).flatMap { dir =>
      val config = AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
      )
      HttpApp.wired[IO](config).evalTap { w =>
        val now = Instant.parse("2024-01-01T00:00:00Z")
        for
          _ <- w.gameTitles
            .create(GameTitle(GameTitleId("title_world"), "桃太郎電鉄ワールド", "world", 1, now))
          _ <- w.mapMasters
            .create(MapMaster(MapMasterId("map_east"), GameTitleId("title_world"), "東日本編", 1, now))
          _ <- w.seasonMasters.create(SeasonMaster(
            SeasonMasterId("season_2024_spring"),
            GameTitleId("title_world"),
            "2024-spring",
            1,
            now,
          ))
        yield ()
      }.map(_.app)
    }

  private def authHeaders: List[Header.ToRaw] = List[Header.ToRaw](
    Header.Raw(CIString("X-Dev-User"), "ponta"),
    Header.Raw(CIString("X-CSRF-Token"), "dev"),
  )

  private def readHeader = Header.Raw(CIString("X-Dev-User"), "ponta")

  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  private def incidents = Json.obj(
    "destination" -> Json.fromInt(1),
    "plusStation" -> Json.fromInt(0),
    "minusStation" -> Json.fromInt(0),
    "cardStation" -> Json.fromInt(0),
    "cardShop" -> Json.fromInt(0),
    "suriNoGinji" -> Json.fromInt(0),
  )

  private def player(memberId: String, playOrder: Int, rank: Int): Json = Json.obj(
    "memberId" -> Json.fromString(memberId),
    "playOrder" -> Json.fromInt(playOrder),
    "rank" -> Json.fromInt(rank),
    "totalAssetsManYen" -> Json.fromInt(100),
    "revenueManYen" -> Json.fromInt(50),
    "incidents" -> incidents,
  )

  test("POST /api/held-events creates event and lists it") {
    app.use { httpApp =>
      val createReq = Request[IO](Method.POST, uri"/api/held-events").putHeaders(authHeaders*)
        .withEntity(Json.obj("heldAt" -> Json.fromString("2024-01-01T00:00:00Z")))
      for
        createRes <- httpApp.run(createReq)
        _ = assertEquals(createRes.status, Status.Ok)
        body <- createRes.as[Json]
        id = jsonField[String](body, "id")
        listRes <- httpApp
          .run(Request[IO](Method.GET, uri"/api/held-events").putHeaders(readHeader))
        _ = assertEquals(listRes.status, Status.Ok)
        listBody <- listRes.as[Json]
        items = jsonField[List[Json]](listBody, "items")
      yield items match
        case item :: Nil => assertEquals(jsonField[String](item, "id"), id)
        case other => fail(s"expected exactly 1 held event, got: ${other.map(_.noSpaces)}")
    }
  }

  test("POST /api/held-events with invalid heldAt returns 422") {
    app.use { httpApp =>
      val req = Request[IO](Method.POST, uri"/api/held-events").putHeaders(authHeaders*)
        .withEntity(Json.obj("heldAt" -> Json.fromString("not-an-instant")))
      httpApp.run(req).flatMap { res =>
        assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "heldAt")
      }
    }
  }

  test("GET /api/ocr-drafts bulk rejects empty ids") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=").putHeaders(readHeader))
        .flatMap(res => assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "ids"))
    }
  }

  test("GET /api/ocr-drafts bulk returns 404 when a draft is missing") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=missing").putHeaders(readHeader))
        .flatMap(res => assertProblem(res, Status.NotFound, "NOT_FOUND", "ocr draft was not found"))
    }
  }

  private def confirmBody(heldEventId: String): Json = confirmBody(heldEventId, 1)

  private def confirmBody(heldEventId: String, matchNo: Int): Json = Json.obj(
    "heldEventId" -> Json.fromString(heldEventId),
    "matchNoInEvent" -> Json.fromInt(matchNo),
    "gameTitleId" -> Json.fromString("title_world"),
    "seasonMasterId" -> Json.fromString("season_2024_spring"),
    "ownerMemberId" -> Json.fromString("ponta"),
    "mapMasterId" -> Json.fromString("map_east"),
    "playedAt" -> Json.fromString("2024-01-01T20:00:00Z"),
    "draftIds" ->
      Json.obj("totalAssets" -> Json.Null, "revenue" -> Json.Null, "incidentLog" -> Json.Null),
    "players" -> Json.arr(
      player("ponta", 1, 1),
      player("akane-mami", 2, 2),
      player("otaka", 3, 3),
      player("eu", 4, 4),
    ),
  )

  private def createEvent(httpApp: org.http4s.HttpApp[IO]): IO[String] = httpApp.run(
    Request[IO](Method.POST, uri"/api/held-events").putHeaders(authHeaders*)
      .withEntity(Json.obj("heldAt" -> Json.fromString("2024-01-01T00:00:00Z")))
  ).flatMap { response =>
    assertEquals(response.status, Status.Ok)
    response.as[Json].map(jsonField[String](_, "id"))
  }

  private def createMatchDraft(httpApp: org.http4s.HttpApp[IO]): IO[String] =
    val body = Json.obj(
      "heldEventId" -> Json.Null,
      "matchNoInEvent" -> Json.Null,
      "gameTitleId" -> Json.Null,
      "layoutFamily" -> Json.Null,
      "seasonMasterId" -> Json.Null,
      "ownerMemberId" -> Json.Null,
      "mapMasterId" -> Json.Null,
      "playedAt" -> Json.Null,
      "status" -> Json.Null,
    )
    httpApp.run(
      Request[IO](Method.POST, uri"/api/match-drafts").putHeaders(authHeaders*).withEntity(body)
    ).flatMap { response =>
      assertEquals(response.status, Status.Ok)
      response.as[Json].map(jsonField[String](_, "matchDraftId"))
    }

  private def uploadPng(httpApp: org.http4s.HttpApp[IO]): IO[String] =
    val part = Part.fileData[IO](
      "file",
      "source.png",
      Stream.emits(pngBytes).covary[IO],
      `Content-Type`(MediaType.image.png),
    )
    for
      multiparts <- Multiparts.forSync[IO]
      multipart <- multiparts.multipart(Vector(part))
      response <- httpApp.run(
        Request[IO](Method.POST, uri"/api/uploads/images").putHeaders(authHeaders*)
          .putHeaders(multipart.headers).withEntity(multipart)
      )
      body <- response.as[Json]
    yield
      assertEquals(response.status, Status.Ok)
      jsonField[String](body, "imageId")

  test("POST /api/matches confirms with valid body") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        res <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches").putHeaders(authHeaders*)
            .withEntity(confirmBody(id))
        )
        body <- res.as[Json]
      yield
        assertEquals(res.status, Status.Ok)
        assertEquals(jsonField[String](body, "heldEventId"), id)
        assertEquals(jsonField[Int](body, "matchNoInEvent"), 1)
    }
  }

  test("GET /api/match-drafts/:draftId/source-images/:kind returns the stored image media type") {
    app.use { httpApp =>
      for
        matchDraftId <- createMatchDraft(httpApp)
        imageId <- uploadPng(httpApp)
        createJobRes <- httpApp.run(
          Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(authHeaders*).withEntity(Json.obj(
            "imageId" -> Json.fromString(imageId),
            "requestedImageType" -> Json.fromString("total_assets"),
            "matchDraftId" -> Json.fromString(matchDraftId),
          ))
        )
        _ = assertEquals(createJobRes.status, Status.Ok)
        _ <- createJobRes.as[Json]
        sourceImageRes <- httpApp.run(
          Request[IO](
            Method.GET,
            Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images/total_assets"),
          ).putHeaders(readHeader)
        )
        body <- sourceImageRes.as[Array[Byte]]
      yield
        assertEquals(sourceImageRes.status, Status.Ok)
        assertEquals(
          optionalHeaderValue(sourceImageRes, CIString("Content-Type")),
          Some("image/png"),
        )
        assertEquals(body.toVector, pngBytes.toVector)
    }
  }

  test("POST /api/matches maps validation failures to ProblemDetails") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        body = confirmBody(id).hcursor.downField("players").withFocus(_ =>
          Json.arr(
            player("ponta", 1, 1),
            player("akane-mami", 2, 1),
            player("otaka", 3, 3),
            player("eu", 4, 4),
          )
        ).top.get
        res <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches").putHeaders(authHeaders*).withEntity(body)
        )
        _ <- assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "players.rank")
      yield ()
    }
  }

  test("GET /api/exports/matches downloads CSV for confirmed matches") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        create <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches").putHeaders(authHeaders*)
            .withEntity(confirmBody(id, 1))
        )
        _ = assertEquals(create.status, Status.Ok)
        _ <- create.as[Json]
        exportRes <- httpApp
          .run(Request[IO](Method.GET, uri"/api/exports/matches?format=csv").putHeaders(readHeader))
        body <- exportRes.as[String]
      yield
        assertEquals(exportRes.status, Status.Ok)
        assertEquals(
          optionalHeaderValue(exportRes, CIString("Content-Disposition")),
          Some("attachment; filename=\"momo-results-all.csv\""),
        )
        val contentType = headerValue(exportRes, CIString("Content-Type"))
        assert(contentType.contains("text/csv"), s"unexpected content type: $contentType")
        val lines = body.split("\r\n", -1).toList
        assertEquals(
          lines.take(2),
          List(
            "シーズン,シーズンNo.,オーナー,マップ,対戦日,対戦No.,プレー順,プレーヤー名,順位,総資産,収益,目的地,プラス駅,マイナス駅,カード駅,カード売り場,スリの銀次",
            "2024-spring,1,ponta,東日本編,2024-01-02,1,1,ponta,1,100,50,1,0,0,0,0,0",
          ),
        )
        assertEquals(lines.size, 6)
    }
  }

  test("GET /api/exports/matches supports TSV and match scope") {
    app.use { httpApp =>
      for
        id <- createEvent(httpApp)
        create <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches").putHeaders(authHeaders*)
            .withEntity(confirmBody(id, 1))
        )
        createBody <- create.as[Json]
        matchId = jsonField[String](createBody, "matchId")
        exportRes <- httpApp.run(
          Request[IO](
            Method.GET,
            Uri.unsafeFromString(s"/api/exports/matches?format=tsv&matchId=$matchId"),
          ).putHeaders(readHeader)
        )
        body <- exportRes.as[String]
      yield
        assertEquals(exportRes.status, Status.Ok)
        assertEquals(
          optionalHeaderValue(exportRes, CIString("Content-Disposition")),
          Some(s"""attachment; filename="momo-results-match-$matchId.tsv""""),
        )
        val header = body.linesIterator.toList.headOption
          .getOrElse(fail(s"expected TSV header line, got: $body"))
        assert(header.contains("\t"), "TSV header should use tab delimiter")
        assert(body.contains("2024-spring\t1\tponta\t東日本編"))
    }
  }

  test("GET /api/exports/matches validates format and scope") {
    app.use { httpApp =>
      val invalidFormat = Request[IO](Method.GET, uri"/api/exports/matches?format=x")
        .putHeaders(readHeader)
      httpApp.run(invalidFormat).flatMap { res =>
        assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "format")
      }
    }
  }
