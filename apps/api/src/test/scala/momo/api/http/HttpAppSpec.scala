package momo.api.http

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
import momo.api.auth.SessionCookieCodec
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv, ResourceLimitsConfig}
import momo.api.domain.ids.AccountId
import momo.api.http.HttpAssertions.{
  assertProblem, assertProblemDetailEquals, headerValue, jsonField, optionalHeaderValue,
}
import momo.api.testing.TestImages

final class HttpAppSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  private final case class SessionBackedHttpApp(
      app: TestHttpApp,
      sessionCookie: String,
      csrfToken: String,
  )

  private val app = ResourceFunFixture(httpAppResource("momo-api-http"))
  private val prodHstsApp = ResourceFunFixture(prodHttpAppResource("momo-api-prod-hsts"))
  private val prodHttpApp = ResourceFunFixture(prodHttpAppResource("momo-api-prod-http"))
  private val sessionBackedApp = ResourceFunFixture(
    tempDirectory("momo-api-session-auth").flatMap { dir =>
      ApiApp.wired[IO](AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
      )).evalMap { wired =>
        for
          account <- wired.loginAccounts.find(AccountId.unsafeFromString("account_ponta")).flatMap {
            case Some(value) => IO.pure(value)
            case None => IO.raiseError(new IllegalStateException("account_ponta is missing"))
          }
          created <- wired.createSession(account)
          tokens <- IO
            .fromOption(SessionCookieCodec.decode(created.cookieValue))(new IllegalStateException(
              "session cookie could not be decoded"
            ))
        yield SessionBackedHttpApp(wired.app, created.cookieValue, tokens.csrfToken)
      }
    }
  )
  private val uploadLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-upload-limit",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(uploadRequestMaxBytes = 1L)),
  ))
  private val uploadStorageQuotaApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-upload-storage-quota",
    _.copy(resourceLimits =
      ResourceLimitsConfig.defaults.copy(imageUploadUnreferencedCountLimit = 0)
    ),
  ))
  private val uploadStorageDiskFullApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-upload-storage-disk-full",
    _.copy(resourceLimits =
      ResourceLimitsConfig.defaults.copy(imageUploadStorageMinFreeBytes = Long.MaxValue)
    ),
  ))
  private val requestLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-request-limit",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(requestMaxBytes = 1L)),
  ))
  private val exportRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-export-rate",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(exportRateLimitPerMinute = 0)),
  ))
  private val exportAllRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-export-all-rate",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(exportAllRateLimitPerMinute = 0)),
  ))
  private val exportSizeLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-export-size",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(exportMaxBytes = 1L)),
  ))
  private val sourceImageDownloadRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-source-image-download-rate",
    _.copy(resourceLimits =
      ResourceLimitsConfig.defaults.copy(sourceImageDownloadRateLimitPerMinute = 0)
    ),
  ))
  private val readRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-read-rate",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(readApiRateLimitPerMinute = 0)),
  ))
  private val ocrAccountRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-ocr-account-rate",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(ocrJobCreateRateLimitPerMinute = 0)),
  ))
  private val ocrGlobalRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-ocr-global-rate",
    _.copy(resourceLimits =
      ResourceLimitsConfig.defaults.copy(ocrJobCreateGlobalRateLimitPerMinute = 0)
    ),
  ))
  private val ocrActiveLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-ocr-active-limit",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(ocrActiveJobLimit = 0)),
  ))
  private val ocrReplayRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-ocr-replay-rate",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(ocrJobCreateRateLimitPerMinute = 1)),
  ))
  private val pngBytes: Array[Byte] = TestImages.png1x1

  app.test("GET /healthz returns ok") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/healthz")).flatMap { response =>
      response.as[Json].map { body =>
        assertEquals(response.status, Status.Ok)
        assertEquals(jsonField[String](body, "status"), "ok")
      }
    }
  }

  app.test("GET /healthz/details reports disabled optional dependencies in in-memory mode") {
    httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/healthz/details")).flatMap { response =>
        response.as[Json].map { body =>
          assertEquals(response.status, Status.Ok)
          assertEquals(jsonField[String](body, "status"), "ok")
          assertEquals(jsonField[String](body, "database"), "disabled")
          assertEquals(jsonField[String](body, "redis"), "disabled")
          assertEquals(jsonField[String](body, "ocrAdmission"), "disabled")
        }
      }
  }

  app.test("GET /api/auth/me authenticates fixed dev member") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/auth/me").putHeaders(devReadHeader())
    httpApp.run(request).flatMap { response =>
      response.as[Json].map { body =>
        assertEquals(response.status, Status.Ok)
        assertEquals(jsonField[String](body, "accountId"), "account_ponta")
        assertEquals(jsonField[String](body, "memberId"), "member_ponta")
        assertEquals(jsonField[Boolean](body, "isAdmin"), true)
        assertEquals(jsonField[String](body, "csrfToken"), "dev")
      }
    }
  }

  app.test("GET /api/auth/login?silent=1 requests Discord prompt=none") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/api/auth/login?silent=1")).map { response =>
      assertEquals(response.status, Status.Found)
      val location = headerValue(response, CIString("Location"))
      assert(location.contains("prompt=none"), s"expected prompt=none in redirect: $location")
    }
  }

  app.test("GET /api/auth/login without silent omits Discord prompt") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/api/auth/login")).map { response =>
      assertEquals(response.status, Status.Found)
      val location = headerValue(response, CIString("Location"))
      assert(!location.contains("prompt="), s"did not expect prompt in redirect: $location")
    }
  }

  app.test("silent OAuth callback failure falls back to interactive login") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/api/auth/login?silent=1")).flatMap { loginResponse =>
      val stateCookie = loginResponse.cookies.find(_.name == "momo_result_oauth_state")
        .getOrElse(fail("missing oauth state cookie"))
      val callbackRequest = Request[IO](
        Method.GET,
        uri"/api/auth/callback".withQueryParam("error", "access_denied")
          .withQueryParam("state", stateCookie.content),
      ).putHeaders(Header.Raw(CIString("Cookie"), s"${stateCookie.name}=${stateCookie.content}"))

      httpApp.run(callbackRequest).map { callbackResponse =>
        assertEquals(callbackResponse.status, Status.Found)
        assertEquals(headerValue(callbackResponse, CIString("Location")), "/api/auth/login")
        val cleared = callbackResponse.cookies.find(_.name == "momo_result_oauth_state")
          .getOrElse(fail("missing cleared oauth state cookie"))
        assertEquals(cleared.content, "")
        assertEquals(cleared.maxAge, Some(0L))
      }
    }
  }

  app.test("silent OAuth callback failure preserves a safe next path") { httpApp =>
    val loginRequest = Request[IO](
      Method.GET,
      uri"/api/auth/login".withQueryParam("silent", "1")
        .withQueryParam("next", "/exports?format=tsv"),
    )
    httpApp.run(loginRequest).flatMap { loginResponse =>
      val stateCookie = loginResponse.cookies.find(_.name == "momo_result_oauth_state")
        .getOrElse(fail("missing oauth state cookie"))
      val callbackRequest = Request[IO](
        Method.GET,
        uri"/api/auth/callback".withQueryParam("error", "login_required")
          .withQueryParam("state", stateCookie.content),
      ).putHeaders(Header.Raw(CIString("Cookie"), s"${stateCookie.name}=${stateCookie.content}"))

      httpApp.run(callbackRequest).map { callbackResponse =>
        assertEquals(callbackResponse.status, Status.Found)
        assertEquals(
          headerValue(callbackResponse, CIString("Location")),
          "/api/auth/login?next=%2Fexports%3Fformat%3Dtsv",
        )
      }
    }
  }

  sessionBackedApp.test("GET /api/auth/me accepts a session cookie in test env") { fixture =>
    val request = Request[IO](Method.GET, uri"/api/auth/me")
      .putHeaders(sessionCookieHeader(fixture.sessionCookie))
    fixture.app.run(request).flatMap { response =>
      response.as[Json].map { body =>
        assertEquals(response.status, Status.Ok)
        assertEquals(jsonField[String](body, "accountId"), "account_ponta")
        assertEquals(jsonField[String](body, "csrfToken"), fixture.csrfToken)
      }
    }
  }

  sessionBackedApp
    .test("admin mutation accepts session auth and session CSRF in test env") { fixture =>
      val request = Request[IO](Method.POST, uri"/api/admin/login-accounts").putHeaders(
        sessionCookieHeader(fixture.sessionCookie),
        Header.Raw(CIString("X-CSRF-Token"), fixture.csrfToken),
      ).withEntity(Json.obj(
        "discordUserId" -> Json.fromString("123456789012345678"),
        "displayName" -> Json.fromString("operator-from-session"),
        "playerMemberId" -> Json.Null,
        "loginEnabled" -> Json.fromBoolean(true),
        "isAdmin" -> Json.fromBoolean(false),
      ))
      fixture.app.run(request).flatMap { response =>
        response.as[Json].map { body =>
          assertEquals(response.status, Status.Ok)
          assertEquals(jsonField[String](body, "displayName"), "operator-from-session")
        }
      }
    }

  app.test("GET /api/admin/login-accounts is restricted to administrator accounts") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/admin/login-accounts")
      .putHeaders(devReadHeader("account_akane_mami"))
    httpApp.run(request).flatMap(response =>
      assertProblemDetailEquals(
        response,
        Status.Forbidden,
        "FORBIDDEN",
        "Administrator access is required.",
      )
    )
  }

  app.test("GET /api/admin/login-accounts lists operator accounts for administrators") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/admin/login-accounts")
      .putHeaders(devReadHeader())
    httpApp.run(request).flatMap { response =>
      response.as[Json].map { body =>
        assertEquals(response.status, Status.Ok)
        val accountIds = body.hcursor.downField("items").as[List[Json]].fold(
          error => fail(s"expected items: ${error.getMessage}; body=${body.noSpaces}"),
          _.flatMap(_.hcursor.get[String]("accountId").toOption),
        )
        assert(
          accountIds.contains("account_ponta"),
          s"account_ponta account is missing: $accountIds",
        )
      }
    }
  }

  app.test("POST /api/admin/login-accounts creates an operator-only account") { httpApp =>
    val request = Request[IO](Method.POST, uri"/api/admin/login-accounts")
      .putHeaders(devWriteHeaders()*).withEntity(Json.obj(
        "discordUserId" -> Json.fromString("123456789012345678"),
        "displayName" -> Json.fromString("operator"),
        "playerMemberId" -> Json.Null,
        "loginEnabled" -> Json.fromBoolean(true),
        "isAdmin" -> Json.fromBoolean(false),
      ))
    httpApp.run(request).flatMap { response =>
      response.as[Json].map { body =>
        assertEquals(response.status, Status.Ok)
        assertEquals(jsonField[String](body, "displayName"), "operator")
        assertEquals(jsonField[Option[String]](body, "playerMemberId"), None)
        assertEquals(jsonField[Boolean](body, "isAdmin"), false)
      }
    }
  }

  app.test("admin login account mutations reject blank ids at the HTTP boundary") { httpApp =>
    val create = Request[IO](Method.POST, uri"/api/admin/login-accounts")
      .putHeaders(devWriteHeaders()*).withEntity(Json.obj(
        "discordUserId" -> Json.fromString(" "),
        "displayName" -> Json.fromString("operator"),
        "playerMemberId" -> Json.Null,
        "loginEnabled" -> Json.fromBoolean(true),
        "isAdmin" -> Json.fromBoolean(false),
      ))
    val update = Request[IO](Method.PATCH, uri"/api/admin/login-accounts/account_ponta")
      .putHeaders(devWriteHeaders()*).withEntity(Json.obj("playerMemberId" -> Json.fromString(" ")))
    for
      createResponse <- httpApp.run(create)
      _ <- assertProblemDetailEquals(
        createResponse,
        Status.UnprocessableContent,
        "VALIDATION_FAILED",
        "discordUserId must not be blank.",
      )
      updateResponse <- httpApp.run(update)
      _ <- assertProblemDetailEquals(
        updateResponse,
        Status.UnprocessableContent,
        "VALIDATION_FAILED",
        "playerMemberId must not be blank.",
      )
    yield ()
  }

  app.test("PATCH /api/admin/login-accounts keeps at least one enabled administrator") { httpApp =>
    val request = Request[IO](Method.PATCH, uri"/api/admin/login-accounts/account_ponta")
      .putHeaders(devWriteHeaders()*)
      .withEntity(Json.obj("loginEnabled" -> Json.fromBoolean(false)))
    httpApp.run(request).flatMap(response =>
      assertProblemDetailEquals(
        response,
        Status.Conflict,
        "CONFLICT",
        "At least one enabled administrator account is required.",
      )
    )
  }

  app.test("mutation without development CSRF token is rejected") { httpApp =>
    val request = Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devReadHeader())
      .withEntity(HttpRequestBodies.Matches.createOcrJob("missing", "auto"))
    httpApp.run(request).flatMap(response =>
      assertProblemDetailEquals(
        response,
        Status.Forbidden,
        "FORBIDDEN",
        "Development CSRF token is required. Use X-CSRF-Token: dev.",
      )
    )
  }

  app.test("protected endpoint without auth header returns 401") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/api/auth/me")).flatMap(response =>
      assertProblemDetailEquals(
        response,
        Status.Unauthorized,
        "UNAUTHORIZED",
        "Authentication is required.",
      )
    )
  }

  app.test("security headers baseline is present on responses (non-prod)") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
      def header(name: String): Option[String] =
        optionalHeaderValue(response, org.typelevel.ci.CIString(name))
      assertEquals(header("X-Content-Type-Options"), Some("nosniff"))
      assertEquals(header("X-Frame-Options"), Some("DENY"))
      assertEquals(header("Referrer-Policy"), Some("no-referrer"))
      assert(header("Permissions-Policy").exists(_.contains("camera=(self)")))
      val csp = headerValue(response, org.typelevel.ci.CIString("Content-Security-Policy"))
      assert(csp.contains("default-src 'self'"), s"missing default-src in $csp")
      assert(csp.contains("frame-ancestors 'none'"), s"missing frame-ancestors in $csp")
      assert(csp.contains("object-src 'none'"), s"missing object-src in $csp")
      assertEquals(header("Strict-Transport-Security"), None, "HSTS must not be set outside prod")
    }
  }

  prodHstsApp.test("HSTS is set on prod responses") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
      val value = headerValue(response, org.typelevel.ci.CIString("Strict-Transport-Security"))
      assert(value.contains("max-age=31536000"), s"unexpected HSTS value: $value")
      assert(value.contains("includeSubDomains"), s"unexpected HSTS value: $value")
    }
  }

  app.test("X-Request-Id is generated when not provided and echoed in the response") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
      val value = headerValue(response, org.typelevel.ci.CIString("X-Request-Id"))
      assert(value.matches("^[A-Za-z0-9_-]{1,64}$"), s"expected UUID-like id, got: $value")
    }
  }

  app
    .test("X-Request-Id from the client is preserved when it matches the safe pattern") { httpApp =>
      val request = Request[IO](Method.GET, uri"/healthz")
        .putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("X-Request-Id"), "abc-123_DEF"))
      httpApp.run(request).map { response =>
        assertEquals(
          optionalHeaderValue(response, org.typelevel.ci.CIString("X-Request-Id")),
          Some("abc-123_DEF"),
        )
      }
    }

  app.test("malicious X-Request-Id values are replaced with a generated id") { httpApp =>
    val request = Request[IO](Method.GET, uri"/healthz").putHeaders(
      org.http4s.Header
        .Raw(org.typelevel.ci.CIString("X-Request-Id"), "bad value with spaces\nand newline")
    )
    httpApp.run(request).map { response =>
      val value = headerValue(response, org.typelevel.ci.CIString("X-Request-Id"))
      assert(
        value != "bad value with spaces\nand newline",
        "unsafe X-Request-Id should not be echoed verbatim",
      )
      assert(value.matches("^[A-Za-z0-9_-]{1,64}$"))
    }
  }

  prodHttpApp
    .test("prod protected endpoint rejects external account header without session cookie") {
      httpApp =>
        val request = Request[IO](Method.GET, uri"/api/held-events").putHeaders(devReadHeader())
        httpApp.run(request).flatMap(response =>
          assertProblemDetailEquals(
            response,
            Status.Unauthorized,
            "UNAUTHORIZED",
            "Authentication is required.",
          )
        )
    }

  app.test("GET /openapi.yaml is not served by API routes") { httpApp =>
    val request = Request[IO](Method.GET, uri"/openapi.yaml").putHeaders(devReadHeader())
    httpApp.run(request).map(response => assertEquals(response.status, Status.NotFound))
  }

  prodHttpApp.test("prod /healthz/details is protected by session middleware") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/healthz/details")).flatMap(response =>
      assertProblemDetailEquals(
        response,
        Status.Unauthorized,
        "UNAUTHORIZED",
        "Authentication is required.",
      )
    )
  }

  uploadLimitApp
    .test("oversized upload requests are rejected before multipart decoding") { httpApp =>
      val request = Request[IO](Method.POST, uri"/api/uploads/images")
        .putHeaders(org.http4s.Header.Raw(CIString("Content-Length"), "2")).withEntity("xx")
      httpApp.run(request).flatMap(response =>
        assertProblem(response, Status.PayloadTooLarge, "PAYLOAD_TOO_LARGE", "Upload request")
      )
    }

  uploadStorageQuotaApp.test("upload endpoint rejects account storage quota overflow") { httpApp =>
    uploadPngRequest.flatMap(request =>
      httpApp.run(request).flatMap(response =>
        assertProblem(
          response,
          Status.TooManyRequests,
          "TOO_MANY_REQUESTS",
          "Too many unprocessed image uploads",
        )
      )
    )
  }

  uploadStorageDiskFullApp.test("upload endpoint rejects disk waterline overflow") { httpApp =>
    uploadPngRequest.flatMap(request =>
      httpApp.run(request).flatMap(response =>
        assertProblem(
          response,
          Status.ServiceUnavailable,
          "SERVICE_UNAVAILABLE",
          "Image upload storage is temporarily unavailable",
        )
      )
    )
  }

  app.test("upload endpoint rejects ambiguous multiple file parts") { httpApp =>
    uploadPngRequest(filePartCount = 2).flatMap(request =>
      httpApp.run(request).flatMap(response =>
        assertProblem(
          response,
          Status.UnprocessableContent,
          "VALIDATION_FAILED",
          "Multipart field 'file' must be provided once.",
        )
      )
    )
  }

  requestLimitApp
    .test("oversized mutation requests are rejected before endpoint decoding") { httpApp =>
      val request = Request[IO](Method.POST, uri"/api/match-drafts")
        .putHeaders(devWriteHeaders() :+ org.http4s.Header.Raw(CIString("Content-Length"), "2")*)
        .withEntity("xx")
      httpApp.run(request).flatMap(response =>
        assertProblem(response, Status.PayloadTooLarge, "PAYLOAD_TOO_LARGE", "Request body")
      )
    }

  exportRateLimitApp.test("scoped export endpoint applies per-member rate limits") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/exports/matches?format=tsv&matchId=match-1")
      .putHeaders(devReadHeader())
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many exports")
    )
  }

  exportAllRateLimitApp
    .test("all-match export endpoint uses a separate per-member rate limit") { httpApp =>
      val request = Request[IO](Method.GET, uri"/api/exports/matches?format=tsv")
        .putHeaders(devReadHeader())
      httpApp.run(request).flatMap(response =>
        assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many exports")
      )
    }

  exportAllRateLimitApp
    .test("all-match export rate limit does not block scoped exports") { httpApp =>
      val request = Request[IO](Method.GET, uri"/api/exports/matches?format=tsv&matchId=missing")
        .putHeaders(devReadHeader())
      httpApp.run(request).flatMap(response =>
        assertProblem(response, Status.NotFound, "NOT_FOUND", "match was not found")
      )
    }

  exportSizeLimitApp
    .test("export endpoint rejects responses above configured byte limit") { httpApp =>
      val request = Request[IO](Method.GET, uri"/api/exports/matches?format=csv")
        .putHeaders(devReadHeader())
      httpApp.run(request).flatMap(response =>
        assertProblem(
          response,
          Status.PayloadTooLarge,
          "PAYLOAD_TOO_LARGE",
          "exceeding the configured limit of 1 bytes",
        )
      )
    }

  readRateLimitApp.test("matches list endpoint applies per-member read rate limits") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/matches").putHeaders(devReadHeader())
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many read requests")
    )
  }

  readRateLimitApp.test("OCR status endpoint applies per-member read rate limits") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/ocr-jobs/00000000-0000-0000-0000-000000000001")
      .putHeaders(devReadHeader())
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many read requests")
    )
  }

  readRateLimitApp.test("OCR draft bulk endpoint applies per-member read rate limits") { httpApp =>
    val request =
      Request[IO](Method.GET, uri"/api/ocr-drafts?ids=00000000-0000-0000-0000-000000000001")
        .putHeaders(devReadHeader())
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many read requests")
    )
  }

  sourceImageDownloadRateLimitApp
    .test("source image endpoint applies per-member rate limits") { httpApp =>
      for
        matchDraftId <- createDraftWithSourceImage(httpApp)
        response <- httpApp.run(
          Request[IO](
            Method.GET,
            Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images/total_assets"),
          ).putHeaders(devReadHeader())
        )
        _ <- assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "元画像の取得")
      yield ()
    }

  sourceImageDownloadRateLimitApp
    .test("source image archive endpoint applies per-member rate limits") { httpApp =>
      for
        matchDraftId <- createDraftWithSourceImage(httpApp)
        response <- httpApp.run(
          Request[IO](
            Method.GET,
            Uri.unsafeFromString(s"/api/match-drafts/$matchDraftId/source-images.zip"),
          ).putHeaders(devReadHeader())
        )
        _ <- assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "元画像の取得")
      yield ()
    }

  ocrAccountRateLimitApp.test("OCR create endpoint applies per-account rate limits") { httpApp =>
    val request = Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createOcrJob("image-1", "total_assets"))
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many OCR jobs")
    )
  }

  ocrGlobalRateLimitApp.test("OCR create endpoint applies global rate limits") { httpApp =>
    val request = Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*)
      .withEntity(HttpRequestBodies.Matches.createOcrJob("image-1", "total_assets"))
    httpApp.run(request).flatMap(response =>
      assertProblem(
        response,
        Status.TooManyRequests,
        "TOO_MANY_REQUESTS",
        "Too many OCR jobs are being created",
      )
    )
  }

  ocrActiveLimitApp.test("OCR create endpoint returns 503 when the active queue is full") { httpApp =>
    for
      imageId <- uploadPng(httpApp)
      response <- httpApp.run(
        Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*)
          .withEntity(HttpRequestBodies.Matches.createOcrJob(imageId, "total_assets"))
      )
      _ <- assertProblem(
        response,
        Status.ServiceUnavailable,
        "SERVICE_UNAVAILABLE",
        "OCR queue is currently full",
      )
    yield ()
  }

  ocrReplayRateLimitApp
    .test("OCR idempotency replay does not consume another create rate-limit token") { httpApp =>
      for
        imageId <- uploadPng(httpApp)
        request = Request[IO](Method.POST, uri"/api/ocr-jobs")
          .putHeaders(devWriteHeadersWithIdempotency(Some("ocr-replay-key"))*)
          .withEntity(HttpRequestBodies.Matches.createOcrJob(imageId, "total_assets"))
        first <- httpApp.run(request)
        firstBody <- first.as[Json]
        second <- httpApp.run(request)
        secondBody <- second.as[Json]
      yield
        assertEquals(first.status, Status.Ok)
        assertEquals(second.status, Status.Ok)
        assertEquals(jsonField[String](secondBody, "jobId"), jsonField[String](firstBody, "jobId"))
    }

  private def sessionCookieHeader(value: String): Header.Raw = Header
    .Raw(CIString("Cookie"), s"momo_result_session=$value")

  private def uploadPng(httpApp: TestHttpApp): IO[String] = uploadPngRequest.flatMap { request =>
    for
      response <- httpApp.run(request)
      body <- response.as[Json]
    yield
      assertEquals(response.status, Status.Ok)
      jsonField[String](body, "imageId")
  }

  private def createDraftWithSourceImage(httpApp: TestHttpApp): IO[String] =
    for
      draftResponse <- httpApp.run(
        Request[IO](Method.POST, uri"/api/match-drafts").putHeaders(devWriteHeaders()*)
          .withEntity(HttpRequestBodies.Matches.emptyMatchDraft)
      )
      draftBody <- draftResponse.as[Json]
      _ = assertEquals(draftResponse.status, Status.Ok)
      draftId = jsonField[String](draftBody, "matchDraftId")
      imageId <- uploadPng(httpApp)
      createJobResponse <- httpApp
        .run(Request[IO](Method.POST, uri"/api/ocr-jobs").putHeaders(devWriteHeaders()*).withEntity(
          HttpRequestBodies.Matches.createOcrJobForDraft(imageId, "total_assets", draftId)
        ))
      _ = assertEquals(createJobResponse.status, Status.Ok)
    yield draftId

  private def uploadPngRequest: IO[Request[IO]] = uploadPngRequest(filePartCount = 1)

  private def uploadPngRequest(filePartCount: Int): IO[Request[IO]] =
    val parts = Vector.tabulate(filePartCount) { index =>
      Part.fileData[IO](
        "file",
        s"source-${index + 1}.png",
        Stream.emits(pngBytes).covary[IO],
        `Content-Type`(MediaType.image.png),
      )
    }
    for
      multiparts <- Multiparts.forSync[IO]
      multipart <- multiparts.multipart(parts)
    yield Request[IO](Method.POST, uri"/api/uploads/images").putHeaders(devWriteHeaders()*)
      .putHeaders(multipart.headers).withEntity(multipart)
