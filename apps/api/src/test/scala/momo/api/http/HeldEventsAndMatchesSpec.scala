package momo.api.http

import cats.effect.IO
import fs2.Stream
import io.circe.Json
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.implicits.*
import org.http4s.multipart.{Multiparts, Part}
import org.http4s.{MediaType, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.http.HttpAssertions.{assertProblem, headerValue, jsonField, optionalHeaderValue}

final class HeldEventsAndMatchesSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  import java.time.Instant
  import momo.api.domain.ids.*
  import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}

  private val app = ResourceFunFixture(seededWiredHttpAppResource("momo-api-held", seedMasters))

  private def seedMasters(wired: HttpApp.Wired[IO]): IO[Unit] =
    val now = Instant.parse("2024-01-01T00:00:00Z")
    for
      _ <- wired.gameTitles
        .create(GameTitle(GameTitleId("title_world"), "桃太郎電鉄ワールド", "world", 1, now))
      _ <- wired.mapMasters
        .create(MapMaster(MapMasterId("map_east"), GameTitleId("title_world"), "東日本編", 1, now))
      _ <- wired.seasonMasters.create(SeasonMaster(
        SeasonMasterId("season_2024_spring"),
        GameTitleId("title_world"),
        "2024-spring",
        1,
        now,
      ))
    yield ()

  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  app.test("POST /api/held-events creates event and lists it") { httpApp =>
    val createReq = Request[IO](Method.POST, uri"/api/held-events").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createHeldEvent("2024-01-01T00:00:00Z"))
    for
      createRes <- httpApp.run(createReq)
      _ = assertEquals(createRes.status, Status.Ok)
      body <- createRes.as[Json]
      id = jsonField[String](body, "id")
      listRes <- httpApp
        .run(Request[IO](Method.GET, uri"/api/held-events").putHeaders(devReadHeader()))
      _ = assertEquals(listRes.status, Status.Ok)
      listBody <- listRes.as[Json]
      items = jsonField[List[Json]](listBody, "items")
    yield items match
      case item :: Nil => assertEquals(jsonField[String](item, "id"), id)
      case other => fail(s"expected exactly 1 held event, got: ${other.map(_.noSpaces)}")
  }

  app.test("POST /api/held-events with invalid heldAt returns 422") { httpApp =>
    val req = Request[IO](Method.POST, uri"/api/held-events").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createHeldEvent("not-an-instant"))
    httpApp.run(req).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "heldAt")
    }
  }

  app.test("DELETE /api/held-events/:id deletes an empty held event") { httpApp =>
    for
      id <- createEvent(httpApp)
      res <- httpApp.run(
        Request[IO](Method.DELETE, Uri.unsafeFromString(s"/api/held-events/$id"))
          .putHeaders(devWriteHeaders()*)
      )
      _ = assertEquals(res.status, Status.Ok)
      body <- res.as[Json]
      listRes <- httpApp
        .run(Request[IO](Method.GET, uri"/api/held-events").putHeaders(devReadHeader()))
      listBody <- listRes.as[Json]
      items = jsonField[List[Json]](listBody, "items")
    yield
      assertEquals(jsonField[String](body, "heldEventId"), id)
      assertEquals(jsonField[Boolean](body, "deleted"), true)
      assertEquals(items.exists(item => jsonField[String](item, "id") == id), false)
  }

  app
    .test("DELETE /api/held-events/:id returns 409 when a confirmed match references it") { httpApp =>
      for
        id <- createEvent(httpApp)
        createMatchRes <- httpApp.run(
          Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
            .withEntity(confirmBody(id))
        )
        _ = assertEquals(createMatchRes.status, Status.Ok)
        res <- httpApp.run(
          Request[IO](Method.DELETE, Uri.unsafeFromString(s"/api/held-events/$id"))
            .putHeaders(devWriteHeaders()*)
        )
        _ <- assertProblem(res, Status.Conflict, "CONFLICT", "confirmed matches")
      yield ()
    }

  app.test("DELETE /api/held-events/:id returns 409 when a match draft references it") { httpApp =>
    for
      id <- createEvent(httpApp)
      createDraftRes <- httpApp.run(
        Request[IO](Method.POST, uri"/api/match-drafts").putHeaders(devWriteHeaders()*)
          .withEntity(HttpRequestBodies.Matches.matchDraftForHeldEvent(id))
      )
      _ = assertEquals(createDraftRes.status, Status.Ok)
      res <- httpApp.run(
        Request[IO](Method.DELETE, Uri.unsafeFromString(s"/api/held-events/$id"))
          .putHeaders(devWriteHeaders()*)
      )
      _ <- assertProblem(res, Status.Conflict, "CONFLICT", "match drafts")
    yield ()
  }

  app.test("GET /api/ocr-drafts bulk rejects empty ids") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=").putHeaders(devReadHeader()))
      .flatMap(res => assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "ids"))
  }

  app.test("GET /api/ocr-drafts bulk returns 404 when a draft is missing") { httpApp =>
    httpApp
      .run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=missing").putHeaders(devReadHeader()))
      .flatMap(res => assertProblem(res, Status.NotFound, "NOT_FOUND", "ocr draft was not found"))
  }

  private def confirmBody(heldEventId: String): Json = confirmBody(heldEventId, 1)

  private def confirmBody(heldEventId: String, matchNo: Int): Json = HttpRequestBodies.Matches
    .confirmMatchWithNo(heldEventId, matchNo)

  private def createEvent(httpApp: org.http4s.HttpApp[IO]): IO[String] = httpApp.run(
    Request[IO](Method.POST, uri"/api/held-events").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createHeldEvent("2024-01-01T00:00:00Z"))
  ).flatMap { response =>
    assertEquals(response.status, Status.Ok)
    response.as[Json].map(jsonField[String](_, "id"))
  }

  private def createMatchDraft(httpApp: org.http4s.HttpApp[IO]): IO[String] = httpApp.run(
    Request[IO](Method.POST, uri"/api/match-drafts").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.emptyMatchDraft)
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
        Request[IO](Method.POST, uri"/api/uploads/images").putHeaders(devWriteHeaders()*)
          .putHeaders(multipart.headers).withEntity(multipart)
      )
      body <- response.as[Json]
    yield
      assertEquals(response.status, Status.Ok)
      jsonField[String](body, "imageId")

  app.test("POST /api/matches confirms with valid body") { httpApp =>
    for
      id <- createEvent(httpApp)
      res <- httpApp.run(
        Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
          .withEntity(confirmBody(id))
      )
      body <- res.as[Json]
    yield
      assertEquals(res.status, Status.Ok)
      assertEquals(jsonField[String](body, "heldEventId"), id)
      assertEquals(jsonField[Int](body, "matchNoInEvent"), 1)
  }

  app.test(
    "GET /api/match-drafts/:draftId/source-images/:kind returns the stored image media type"
  ) { httpApp =>
    for
      matchDraftId <- createMatchDraft(httpApp)
      imageId <- uploadPng(httpApp)
      createJobRes <- httpApp
        .run(Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*).withEntity(
          HttpRequestBodies.Matches.createOcrJobForDraft(imageId, "total_assets", matchDraftId)
        ))
      _ = assertEquals(createJobRes.status, Status.Ok)
      _ <- createJobRes.as[Json]
      sourceImageRes <- httpApp.run(
        Request[IO](
          Method.GET,
          Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images/total_assets"),
        ).putHeaders(devReadHeader())
      )
      body <- sourceImageRes.as[Array[Byte]]
    yield
      assertEquals(sourceImageRes.status, Status.Ok)
      assertEquals(optionalHeaderValue(sourceImageRes, CIString("Content-Type")), Some("image/png"))
      assertEquals(body.toVector, pngBytes.toVector)
  }

  app.test("POST /api/matches maps validation failures to ProblemDetails") { httpApp =>
    for
      id <- createEvent(httpApp)
      body = HttpRequestBodies.Matches.confirmMatchWithPlayers(
        id,
        1,
        players = List(
          HttpRequestBodies.Matches.player("member_ponta", 1, 1),
          HttpRequestBodies.Matches.player("member_akane_mami", 2, 1),
          HttpRequestBodies.Matches.player("member_otaka", 3, 3),
          HttpRequestBodies.Matches.player("member_eu", 4, 4),
        ),
      )
      res <- httpApp.run(
        Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*).withEntity(body)
      )
      _ <- assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "players.rank")
    yield ()
  }

  app.test("GET /api/exports/matches downloads CSV for confirmed matches") { httpApp =>
    for
      id <- createEvent(httpApp)
      create <- httpApp.run(
        Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
          .withEntity(confirmBody(id, 1))
      )
      _ = assertEquals(create.status, Status.Ok)
      _ <- create.as[Json]
      exportRes <- httpApp.run(
        Request[IO](Method.GET, uri"/api/exports/matches?format=csv").putHeaders(devReadHeader())
      )
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
          "2024-spring,1,member_ponta,東日本編,2024-01-02,1,1,member_ponta,1,100,50,1,0,0,0,0,0",
        ),
      )
      assertEquals(lines.size, 6)
  }

  app.test("GET /api/exports/matches supports TSV and match scope") { httpApp =>
    for
      id <- createEvent(httpApp)
      create <- httpApp.run(
        Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
          .withEntity(confirmBody(id, 1))
      )
      createBody <- create.as[Json]
      matchId = jsonField[String](createBody, "matchId")
      exportRes <- httpApp.run(
        Request[IO](
          Method.GET,
          Uri.unsafeFromString(s"/api/exports/matches?format=tsv&matchId=$matchId"),
        ).putHeaders(devReadHeader())
      )
      body <- exportRes.as[String]
    yield
      assertEquals(exportRes.status, Status.Ok)
      assertEquals(
        optionalHeaderValue(exportRes, CIString("Content-Disposition")),
        Some(s"""attachment; filename="momo-results-match-$matchId.tsv""""),
      )
      val contentType = headerValue(exportRes, CIString("Content-Type"))
      assert(
        contentType.contains("text/tab-separated-values"),
        s"unexpected content type: $contentType",
      )
      val lines = body.split("\r\n", -1).toList
      assertEquals(
        lines.take(2),
        List(
          "シーズン\tシーズンNo.\tオーナー\tマップ\t対戦日\t対戦No.\tプレー順\tプレーヤー名\t順位\t総資産\t収益\t目的地\tプラス駅\tマイナス駅\tカード駅\tカード売り場\tスリの銀次",
          "2024-spring\t1\tmember_ponta\t東日本編\t2024-01-02\t1\t1\tmember_ponta\t1\t100\t50\t1\t0\t0\t0\t0\t0",
        ),
      )
      assertEquals(lines.size, 6)
  }

  app.test("GET /api/exports/matches validates format and scope") { httpApp =>
    val invalidFormat = Request[IO](Method.GET, uri"/api/exports/matches?format=x")
      .putHeaders(devReadHeader())
    httpApp.run(invalidFormat).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "format")
    }
  }
