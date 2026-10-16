package momo.api.http

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Header, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.auth.SessionCookieCodec
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv, AuthConfig, ResourceLimitsConfig}
import momo.api.domain.ids.AccountId

final class HttpAttemptAdmissionSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  private def appWith(limits: ResourceLimitsConfig): Resource[IO, TestHttpApp] =
    configuredHttpAppResource("momo-api-attempt", _.copy(resourceLimits = limits))

  private def status(app: TestHttpApp, request: Request[IO]): IO[Status] =
    app.run(request).flatMap(response => response.body.compile.drain.as(response.status))

  private final case class SessionApp(app: TestHttpApp, cookie: Header.Raw, csrf: Header.Raw)

  private def sessionApp(limits: ResourceLimitsConfig): Resource[IO, SessionApp] =
    tempDirectory("momo-api-session-attempt").flatMap { dir =>
      val auth = AuthConfig.defaults(AppEnv.Prod)
      ApiApp.wiredWithHandles[IO](AppConfig(
        appEnv = AppEnv.Prod,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("member_ponta"),
        auth = auth,
        resourceLimits = limits,
      )).evalMap { wired =>
        for
          account <- wired.handles.loginAccounts.find(AccountId.unsafeFromString(DefaultAccountId))
            .flatMap(IO.fromOption(_)(new IllegalStateException("missing test account")))
          created <- wired.handles.createSession(account)
          tokens <- IO.fromOption(SessionCookieCodec.decode(created.cookieValue))(
            new IllegalStateException("invalid test session")
          )
        yield SessionApp(
          wired.runtime.app,
          Header.Raw(CIString("Cookie"), s"${auth.sessionCookieName}=${created.cookieValue}"),
          Header.Raw(CIString("X-CSRF-Token"), tokens.csrfToken),
        )
      }
    }

  test("authenticated reads share one admission across previously limited and unlimited routes") {
    appWith(ResourceLimitsConfig.defaults.copy(readApiRateLimitPerMinute = 2)).use { app =>
      for
        first <- status(app, readGet(uri"/api/matches"))
        second <- status(app, readGet(uri"/api/game-titles"))
        blocked <- status(app, readGet(uri"/api/held-events"))
        otherAccount <- status(app, readGet(uri"/api/game-titles", "account_otaka"))
        mutation <- status(
          app,
          writePost(
            uri"/api/held-events",
            HttpRequestBodies.Matches.createHeldEvent("2024-01-01T00:00:00Z")
          )
        )
      yield
        assertEquals(first, Status.Ok)
        assertEquals(second, Status.Ok)
        assertEquals(blocked, Status.TooManyRequests)
        assertEquals(otherAccount, Status.Ok)
        assertEquals(mutation, Status.Ok)
    }
  }

  test("read admission covers all business route families before domain parsing and I/O") {
    val paths = List(
      "/api/matches",
      "/api/matches/missing",
      "/api/matches/missing/identity",
      "/api/held-events",
      "/api/held-events/missing/summary",
      "/api/match-drafts/missing",
      "/api/match-drafts/missing/review",
      "/api/match-drafts/missing/source-images",
      "/api/match-drafts/missing/source-images/total_assets",
      "/api/match-drafts/missing/source-images.zip",
      "/api/game-titles",
      "/api/admin/login-accounts",
      "/api/admin/notification-settings",
      "/api/ocr-jobs/missing",
      "/api/ocr-drafts/missing",
      "/api/ocr-submissions/missing",
      "/api/analytics/series-comparison/v2/options",
      "/api/admin/series-analysis/overview",
      "/api/admin/series-analysis/radar/revisions",
      "/api/exports/matches?format=csv",
    )
    appWith(ResourceLimitsConfig.defaults.copy(readApiRateLimitPerMinute = 0)).use { app =>
      paths.traverse_(path =>
        status(app, readGet(Uri.unsafeFromString(path))).map { result =>
          assertEquals(result, Status.TooManyRequests, path)
        }
      )
    }
  }

  test(
    "session mutation attempts precede CSRF and body; unauthenticated requests do not consume them"
  ) {
    sessionApp(ResourceLimitsConfig.defaults.copy(mutationAttemptRateLimitPerMinute = 1)).use {
      fixture =>
        for
          pulled <- IO.ref(0)
          body = Stream.eval(pulled.update(_ + 1)).drain ++
            Stream.emits("invalid JSON".getBytes).covary[IO]
          request = Request[IO](Method.POST, uri"/api/held-events")
            .withEntity(Json.obj()).withBodyStream(body)
          unauthenticated <- status(fixture.app, request)
          missingCsrf <- status(fixture.app, request.putHeaders(fixture.cookie))
          blocked <- status(fixture.app, request.putHeaders(fixture.cookie, fixture.csrf))
          multipart = Request[IO](Method.POST, uri"/api/uploads/images")
            .putHeaders(
              fixture.cookie,
              fixture.csrf,
              Header.Raw(CIString("Content-Type"), "multipart/form-data; boundary=attempt-boundary")
            )
            .withBodyStream(Stream.eval(pulled.update(_ + 1)).drain ++ Stream.emits(
              "--attempt-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.png\"\r\nContent-Type: image/png\r\n\r\nimage\r\n--attempt-boundary--\r\n".getBytes
            ).covary[IO])
          blockedUpload <- status(fixture.app, multipart)
          pulls <- pulled.get
          read <- status(
            fixture.app,
            Request[IO](Method.GET, uri"/api/game-titles").putHeaders(fixture.cookie)
          )
        yield
          assertEquals(unauthenticated, Status.Unauthorized)
          assertEquals(missingCsrf, Status.Forbidden)
          assertEquals(blocked, Status.TooManyRequests)
          assertEquals(blockedUpload, Status.TooManyRequests)
          assertEquals(pulls, 0)
          assertEquals(read, Status.Ok)
    }
  }

  test("development account mutations also consume attempts before CSRF and body") {
    appWith(ResourceLimitsConfig.defaults.copy(mutationAttemptRateLimitPerMinute = 1)).use { app =>
      val missingCsrf = readRequest(Method.POST, uri"/api/held-events").withEntity(Json.obj())
      for
        first <- status(app, missingCsrf)
        next <- status(app, writePost(uri"/api/held-events", Json.obj()))
      yield
        assertEquals(first, Status.Forbidden)
        assertEquals(next, Status.TooManyRequests)
    }
  }

  test("malformed JSON consumes an attempt without consuming the fresh mutation budget") {
    appWith(ResourceLimitsConfig.defaults.copy(
      mutationAttemptRateLimitPerMinute = 2,
      mutationRateLimitPerMinute = 1,
    )).use { app =>
      val malformed = writeRequest(Method.POST, uri"/api/held-events").withEntity(Json.obj())
        .withBodyStream(Stream.emits("{".getBytes).covary[IO])
      for
        invalid <- status(app, malformed)
        valid <- status(
          app,
          writePost(
            uri"/api/held-events",
            HttpRequestBodies.Matches.createHeldEvent("2024-01-01T00:00:00Z")
          )
        )
        next <- status(app, malformed)
      yield
        assertEquals(invalid, Status.BadRequest)
        assertEquals(valid, Status.Ok)
        assertEquals(next, Status.TooManyRequests)
    }
  }

  test("replays consume attempts but remain available after fresh mutation quota is exhausted") {
    appWith(ResourceLimitsConfig.defaults.copy(
      mutationAttemptRateLimitPerMinute = 4,
      mutationRateLimitPerMinute = 1,
    )).use { app =>
      val request = writePost(
        uri"/api/held-events",
        HttpRequestBodies.Matches.createHeldEvent("2024-01-01T00:00:00Z"),
        Some("attempt-replay")
      )
      for
        first <- app.run(request)
        firstBody <- first.as[Json]
        fresh <- status(
          app,
          writePost(
            uri"/api/held-events",
            HttpRequestBodies.Matches.createHeldEvent("2024-02-01T00:00:00Z"),
            Some("attempt-new")
          )
        )
        replay <- app.run(request)
        replayBody <- replay.as[Json]
        replayAgain <- status(app, request)
        blockedReplay <- status(app, request)
      yield
        assertEquals(first.status, Status.Ok)
        assertEquals(fresh, Status.TooManyRequests)
        assertEquals(replay.status, Status.Ok)
        assertEquals(replayBody, firstBody)
        assertEquals(replayAgain, Status.Ok)
        assertEquals(blockedReplay, Status.TooManyRequests)
    }
  }

  test(
    "auth session operations have their own shared account budget and logout checks it before CSRF"
  ) {
    sessionApp(ResourceLimitsConfig.defaults.copy(
      readApiRateLimitPerMinute = 0,
      mutationAttemptRateLimitPerMinute = 0,
      authSessionRateLimitPerMinute = 2,
    )).use { fixture =>
      for
        read <- status(
          fixture.app,
          Request[IO](Method.GET, uri"/api/game-titles").putHeaders(fixture.cookie)
        )
        me <-
          status(fixture.app, Request[IO](Method.GET, uri"/api/auth/me").putHeaders(fixture.cookie))
        missingCsrf <- status(
          fixture.app,
          Request[IO](Method.POST, uri"/api/auth/logout").putHeaders(fixture.cookie)
        )
        blocked <- status(
          fixture.app,
          Request[IO](Method.POST, uri"/api/auth/logout").putHeaders(fixture.cookie)
        )
        publicHealth <- status(fixture.app, Request[IO](Method.GET, uri"/healthz"))
        details <- status(
          fixture.app,
          Request[IO](Method.GET, uri"/healthz/details").putHeaders(fixture.cookie)
        )
      yield
        assertEquals(read, Status.TooManyRequests)
        assertEquals(me, Status.Ok)
        assertEquals(missingCsrf, Status.Forbidden)
        assertEquals(blocked, Status.TooManyRequests)
        assertEquals(publicHealth, Status.Ok)
        assertEquals(details, Status.TooManyRequests)
    }
  }

  test("logout remains available when business quotas are exhausted") {
    sessionApp(ResourceLimitsConfig.defaults.copy(
      readApiRateLimitPerMinute = 0,
      mutationAttemptRateLimitPerMinute = 0,
      authSessionRateLimitPerMinute = 1,
    )).use { fixture =>
      for
        loggedOut <- status(
          fixture.app,
          Request[IO](Method.POST, uri"/api/auth/logout")
            .putHeaders(fixture.cookie, fixture.csrf)
        )
        me <-
          status(fixture.app, Request[IO](Method.GET, uri"/api/auth/me").putHeaders(fixture.cookie))
      yield
        assertEquals(loggedOut, Status.NoContent)
        assertEquals(me, Status.Unauthorized)
    }
  }

  test(
    "OCR submission replay skips fresh admission but conflicting and new requests remain guarded"
  ) {
    appWith(ResourceLimitsConfig.defaults.copy(ocrJobCreateRateLimitPerMinute = 1)).use { app =>
      val id = java.util.UUID.randomUUID().toString
      val uri = Uri.unsafeFromString(s"/api/ocr-submissions/$id")
      for
        draft <-
          app.run(writePost(uri"/api/match-drafts", HttpRequestBodies.Matches.emptyMatchDraft))
        draftBody <- draft.as[Json]
        draftId = HttpAssertions.jsonField[String](draftBody, "matchDraftId")
        body = Json.obj(
          "matchDraftId" -> Json.fromString(draftId),
          "members" -> Json.arr(Json.obj(
            "screenType" -> Json.fromString("total_assets"),
            "uploadIdempotencyKey" -> Json.fromString("submission-admission"),
            "imageSha256" -> Json.fromString("b" * 64),
            "imageByteLength" -> Json.fromInt(1),
          )),
        )
        request = writeRequest(Method.PUT, uri).withEntity(body)
        first <- app.run(request)
        firstBody <- first.as[Json]
        replay <- app.run(request)
        replayBody <- replay.as[Json]
        conflict <- status(
          app,
          writeRequest(Method.PUT, uri).withEntity(
            body.deepMerge(Json.obj("matchDraftId" -> Json.fromString("different-draft")))
          )
        )
        otherAccount <- status(app, writeRequest(Method.PUT, uri, "account_otaka").withEntity(body))
        fresh <- status(
          app,
          writeRequest(
            Method.PUT,
            Uri.unsafeFromString(s"/api/ocr-submissions/${java.util.UUID.randomUUID()}")
          )
            .withEntity(body)
        )
      yield
        assertEquals(first.status, Status.Ok)
        assertEquals(replay.status, Status.Ok)
        assertEquals(replayBody, firstBody)
        assertEquals(conflict, Status.Conflict)
        assertEquals(otherAccount, Status.Conflict)
        assertEquals(fresh, Status.TooManyRequests)
    }
  }
