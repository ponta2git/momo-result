package momo.api.http

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import java.util.zip.ZipInputStream

import cats.effect.IO
import fs2.Stream
import io.circe.Json
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.implicits.*
import org.http4s.multipart.{Multiparts, Part}
import org.http4s.{Header, MediaType, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.bootstrap.ApiApp
import momo.api.http.HttpAssertions.{assertProblem, headerValue, jsonField, optionalHeaderValue}
import momo.api.testing.TestImages

final class HeldEventsAndMatchesSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  import java.time.Instant
  import momo.api.domain.ids.*
  import momo.api.domain.{GameTitle, MapMaster, SeasonMaster}

  private val app = ResourceFunFixture(seededWiredHttpAppResource("momo-api-held", seedMasters))

  private def seedMasters(wired: ApiApp.Runtime[IO]): IO[Unit] =
    val now = Instant.parse("2024-01-01T00:00:00Z")
    for
      _ <- wired.gameTitles.create(
        GameTitle(GameTitleId.unsafeFromString("title_world"), "桃太郎電鉄ワールド", "world", 1, now)
      )
      _ <- wired.mapMasters.create(MapMaster(
        MapMasterId.unsafeFromString("map_east"),
        GameTitleId.unsafeFromString("title_world"),
        "東日本編",
        1,
        now,
      ))
      _ <- wired.seasonMasters.create(SeasonMaster(
        SeasonMasterId.unsafeFromString("season_2024_spring"),
        GameTitleId.unsafeFromString("title_world"),
        "2024-spring",
        1,
        now,
      ))
    yield ()

  private val pngBytes: Array[Byte] = TestImages.png1x1

  private def nonOwnerWriteHeaders(): List[Header.ToRaw] =
    List(devReadHeader("account_eu"), Header.Raw(CIString("X-CSRF-Token"), "dev"))

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

  app.test("GET /api/held-events rejects out-of-range limit") { httpApp =>
    val req = Request[IO](Method.GET, uri"/api/held-events?limit=101").putHeaders(devReadHeader())
    httpApp.run(req)
      .flatMap(res => assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "limit"))
  }

  app.test("GET /api/held-events returns pagination metadata") { httpApp =>
    for
      _ <- createEvent(httpApp)
      _ <- createEvent(httpApp)
      res <- httpApp.run(
        Request[IO](Method.GET, uri"/api/held-events?page=1&pageSize=1").putHeaders(devReadHeader())
      )
      body <- res.as[Json]
      pagination = jsonField[Json](body, "pagination")
    yield
      assertEquals(res.status, Status.Ok)
      assertEquals(jsonField[Int](pagination, "page"), 1)
      assertEquals(jsonField[Int](pagination, "pageSize"), 1)
      assertEquals(jsonField[Int](pagination, "totalItems"), 2)
      assertEquals(jsonField[Boolean](pagination, "hasNextPage"), true)
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

  app.test("POST /api/match-drafts rejects terminal initial statuses") { httpApp =>
    val req = Request[IO](Method.POST, uri"/api/match-drafts").putHeaders(devWriteHeaders()*)
      .withEntity(Json.obj("status" -> Json.fromString("cancelled")))
    httpApp.run(req).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "status")
    }
  }

  app
    .test("PATCH /api/match-drafts/:draftId rejects unknown status at the HTTP boundary") { httpApp =>
      for
        draftId <- createMatchDraft(httpApp)
        req = Request[IO](Method.PATCH, Uri.unsafeFromString(s"/api/match-drafts/$draftId"))
          .putHeaders(devWriteHeaders()*)
          .withEntity(Json.obj("status" -> Json.fromString("not_a_status")))
        res <- httpApp.run(req)
        _ <- assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "status")
      yield ()
    }

  app.test("GET /api/match-drafts/:draftId allows a different account to read the draft") {
    httpApp =>
      for
        draftId <- createMatchDraft(httpApp)
        res <- httpApp.run(
          Request[IO](Method.GET, Uri.unsafeFromString(s"/api/match-drafts/$draftId"))
            .putHeaders(devReadHeader("account_eu"))
        )
        body <- res.as[Json]
      yield
        assertEquals(res.status, Status.Ok)
        assertEquals(jsonField[String](body, "matchDraftId"), draftId)
  }

  app.test("PATCH /api/match-drafts/:draftId allows a different account to update the draft") {
    httpApp =>
      for
        draftId <- createMatchDraft(httpApp)
        res <- httpApp.run(
          Request[IO](Method.PATCH, Uri.unsafeFromString(s"/api/match-drafts/$draftId"))
            .putHeaders(nonOwnerWriteHeaders()*)
            .withEntity(Json.obj("status" -> Json.fromString("needs_review")))
        )
        body <- res.as[Json]
      yield
        assertEquals(res.status, Status.Ok)
        assertEquals(jsonField[String](body, "matchDraftId"), draftId)
        assertEquals(jsonField[String](body, "status"), "needs_review")
  }

  app
    .test("POST /api/match-drafts/:draftId/cancel allows a different account to cancel the draft") {
      httpApp =>
        for
          draftId <- createMatchDraft(httpApp)
          res <- httpApp.run(
            Request[IO](Method.POST, Uri.unsafeFromString(s"/api/match-drafts/$draftId/cancel"))
              .putHeaders(nonOwnerWriteHeaders()*)
          )
          body <- res.as[Json]
        yield
          assertEquals(res.status, Status.Ok)
          assertEquals(jsonField[String](body, "matchDraftId"), draftId)
          assertEquals(jsonField[String](body, "status"), "cancelled")
    }

  app.test("GET /api/ocr-drafts bulk rejects empty ids") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=").putHeaders(devReadHeader()))
      .flatMap(res => assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "ids"))
  }

  app.test("POST /api/ocr-jobs rejects blank image id at the HTTP boundary") { httpApp =>
    val req = Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createOcrJob(" ", "total_assets"))
    httpApp.run(req).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "imageId")
    }
  }

  app.test("POST /api/ocr-jobs rejects unknown screen type at the HTTP boundary") { httpApp =>
    val req = Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createOcrJob("image-1", "unknown"))
    httpApp.run(req).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "requestedScreenType")
    }
  }

  app.test("GET /api/matches rejects blank id query filters at the HTTP boundary") { httpApp =>
    val req = Request[IO](Method.GET, uri"/api/matches?heldEventId=%20").putHeaders(devReadHeader())
    httpApp.run(req).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "heldEventId")
    }
  }

  app.test("GET /api/matches rejects unknown list filters at the HTTP boundary") { httpApp =>
    for
      statusRes <- httpApp
        .run(Request[IO](Method.GET, uri"/api/matches?status=unknown").putHeaders(devReadHeader()))
      _ <- assertProblem(statusRes, Status.UnprocessableContent, "VALIDATION_FAILED", "status")
      kindRes <- httpApp
        .run(Request[IO](Method.GET, uri"/api/matches?kind=unknown").putHeaders(devReadHeader()))
      _ <- assertProblem(kindRes, Status.UnprocessableContent, "VALIDATION_FAILED", "kind")
    yield ()
  }

  app.test("POST /api/matches rejects invalid playedAt at the HTTP boundary") { httpApp =>
    for
      id <- createEvent(httpApp)
      req = Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
        .withEntity(confirmBody(id).deepMerge(Json.obj("playedAt" -> Json.fromString("bad"))))
      res <- httpApp.run(req)
      _ <- assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "playedAt")
    yield ()
  }

  app.test("GET /api/ocr-drafts bulk returns 404 when a draft is missing") { httpApp =>
    httpApp
      .run(Request[IO](Method.GET, uri"/api/ocr-drafts?ids=missing").putHeaders(devReadHeader()))
      .flatMap(res => assertProblem(res, Status.NotFound, "NOT_FOUND", "ocr draft was not found"))
  }

  app.test("GET /api/matches rejects negative limit before repository access") { httpApp =>
    val req = Request[IO](Method.GET, uri"/api/matches?limit=-1").putHeaders(devReadHeader())
    httpApp.run(req)
      .flatMap(res => assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "limit"))
  }

  app.test("GET /api/matches rejects invalid pagination before repository access") { httpApp =>
    val req = Request[IO](Method.GET, uri"/api/matches?page=0").putHeaders(devReadHeader())
    httpApp.run(req)
      .flatMap(res => assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "page"))
  }

  app.test("GET /api/matches returns pagination metadata") { httpApp =>
    for
      id <- createEvent(httpApp)
      first <- httpApp.run(
        Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
          .withEntity(confirmBody(id, 1))
      )
      _ = assertEquals(first.status, Status.Ok)
      second <- httpApp.run(
        Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
          .withEntity(confirmBody(id, 2))
      )
      _ = assertEquals(second.status, Status.Ok)
      res <- httpApp.run(
        Request[IO](Method.GET, uri"/api/matches?page=2&pageSize=1&sort=match_no_asc")
          .putHeaders(devReadHeader())
      )
      body <- res.as[Json]
      pagination = jsonField[Json](body, "pagination")
      items = jsonField[List[Json]](body, "items")
    yield
      assertEquals(res.status, Status.Ok)
      assertEquals(items.size, 1)
      assertEquals(jsonField[Int](pagination, "page"), 2)
      assertEquals(jsonField[Int](pagination, "pageSize"), 1)
      assertEquals(jsonField[Int](pagination, "totalItems"), 2)
      assertEquals(jsonField[Boolean](pagination, "hasPreviousPage"), true)
  }

  app.test("GET /api/matches/summary returns aggregate draft counts") { httpApp =>
    for
      _ <- createMatchDraft(httpApp)
      res <- httpApp
        .run(Request[IO](Method.GET, uri"/api/matches/summary").putHeaders(devReadHeader()))
      body <- res.as[Json]
    yield
      assertEquals(res.status, Status.Ok)
      assertEquals(jsonField[Int](body, "incompleteCount"), 1)
      assertEquals(jsonField[Int](body, "ocrRunningCount"), 0)
      assertEquals(jsonField[Int](body, "preConfirmCount"), 1)
      assertEquals(jsonField[Int](body, "needsReviewCount"), 0)
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

  private def zipEntryNames(bytes: Array[Byte]): Set[String] =
    val names = scala.collection.mutable.Set.empty[String]
    val zip = ZipInputStream(ByteArrayInputStream(bytes))
    try
      @annotation.tailrec
      def readNext(): Unit = Option(zip.getNextEntry) match
        case None => ()
        case Some(entry) =>
          names += entry.getName
          val out = ByteArrayOutputStream()
          zip.transferTo(out)
          zip.closeEntry()
          readNext()

      readNext()
    finally zip.close()
    names.toSet

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
      sourceImageListRes <- httpApp.run(
        Request[IO](
          Method.GET,
          Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images"),
        ).putHeaders(devReadHeader("account_eu"))
      )
      sourceImageListBody <- sourceImageListRes.as[Json]
      sourceImageRes <- httpApp.run(
        Request[IO](
          Method.GET,
          Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images/total_assets"),
        ).putHeaders(devReadHeader("account_eu"))
      )
      body <- sourceImageRes.as[Array[Byte]]
    yield
      assertEquals(sourceImageListRes.status, Status.Ok)
      val items = jsonField[List[Json]](sourceImageListBody, "items")
      assertEquals(items.map(item => jsonField[String](item, "kind")), List("total_assets"))
      assertEquals(sourceImageRes.status, Status.Ok)
      assertEquals(optionalHeaderValue(sourceImageRes, CIString("Content-Type")), Some("image/png"))
      assertEquals(body.toVector, pngBytes.toVector)
  }

  app.test("GET /api/match-drafts/:draftId/source-images.zip downloads source images as zip") {
    httpApp =>
      for
        matchDraftId <- createMatchDraft(httpApp)
        totalAssetsImageId <- uploadPng(httpApp)
        revenueImageId <- uploadPng(httpApp)
        incidentLogImageId <- uploadPng(httpApp)
        totalAssetsJobRes <- httpApp.run(
          Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*).withEntity(
            HttpRequestBodies.Matches
              .createOcrJobForDraft(totalAssetsImageId, "total_assets", matchDraftId)
          )
        )
        _ = assertEquals(totalAssetsJobRes.status, Status.Ok)
        revenueJobRes <- httpApp.run(
          Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*).withEntity(
            HttpRequestBodies.Matches.createOcrJobForDraft(revenueImageId, "revenue", matchDraftId)
          )
        )
        _ = assertEquals(revenueJobRes.status, Status.Ok)
        incidentLogJobRes <- httpApp.run(
          Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*).withEntity(
            HttpRequestBodies.Matches
              .createOcrJobForDraft(incidentLogImageId, "incident_log", matchDraftId)
          )
        )
        _ = assertEquals(incidentLogJobRes.status, Status.Ok)
        archiveRes <- httpApp.run(
          Request[IO](
            Method.GET,
            Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images.zip"),
          ).putHeaders(devReadHeader("account_eu"))
        )
        body <- archiveRes.as[Array[Byte]]
      yield
        assertEquals(archiveRes.status, Status.Ok)
        assertEquals(
          optionalHeaderValue(archiveRes, CIString("Content-Type")),
          Some("application/zip"),
        )
        assertEquals(
          optionalHeaderValue(archiveRes, CIString("Cache-Control")),
          Some("private, no-store"),
        )
        assertEquals(
          optionalHeaderValue(archiveRes, CIString("X-Content-Type-Options")),
          Some("nosniff"),
        )
        val disposition = optionalHeaderValue(archiveRes, CIString("Content-Disposition"))
          .getOrElse(fail("expected Content-Disposition"))
        assert(disposition.startsWith("attachment; filename=\"momo-ocr-images-"))
        assert(disposition.endsWith(".zip\""))
        assert(!disposition.contains(matchDraftId))
        assertEquals(
          zipEntryNames(body),
          Set("01-total-assets.png", "02-revenue.png", "03-incident-log.png"),
        )
  }

  app.test("GET /api/match-drafts/:draftId/source-images/:kind rejects unknown kind") { httpApp =>
    for
      matchDraftId <- createMatchDraft(httpApp)
      sourceImageRes <- httpApp.run(
        Request[IO](
          Method.GET,
          Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images/unknown"),
        ).putHeaders(devReadHeader())
      )
      _ <- assertProblem(sourceImageRes, Status.UnprocessableContent, "VALIDATION_FAILED", "kind")
    yield ()
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

  app.test("POST /api/matches rejects blank player member id at the HTTP boundary") { httpApp =>
    val body = HttpRequestBodies.Matches.confirmMatchWithPlayers(
      "held-any",
      1,
      players = List(
        HttpRequestBodies.Matches.player(" ", 1, 1),
        HttpRequestBodies.Matches.player("member_akane_mami", 2, 2),
        HttpRequestBodies.Matches.player("member_otaka", 3, 3),
        HttpRequestBodies.Matches.player("member_eu", 4, 4),
      ),
    )
    val req = Request[IO](Method.POST, uri"/api/matches").putHeaders(devWriteHeaders()*)
      .withEntity(body)
    httpApp.run(req).flatMap { res =>
      assertProblem(res, Status.UnprocessableContent, "VALIDATION_FAILED", "players.memberId")
    }
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

  app.test("GET /api/exports/matches rejects invalid scopes at the HTTP boundary") { httpApp =>
    for
      blankScope <- httpApp.run(
        Request[IO](Method.GET, uri"/api/exports/matches?format=csv&seasonMasterId=%20")
          .putHeaders(devReadHeader())
      )
      _ <- assertProblem(
        blankScope,
        Status.UnprocessableContent,
        "VALIDATION_FAILED",
        "seasonMasterId",
      )
      multiScope <- httpApp.run(
        Request[IO](
          Method.GET,
          uri"/api/exports/matches?format=csv&seasonMasterId=season_1&heldEventId=held_1",
        ).putHeaders(devReadHeader())
      )
      _ <- assertProblem(multiScope, Status.UnprocessableContent, "VALIDATION_FAILED", "scope")
    yield ()
  }
