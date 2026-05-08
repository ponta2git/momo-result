package momo.api.http

import cats.effect.IO
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.config.ResourceLimitsConfig
import momo.api.http.HttpAssertions.{
  assertProblem, assertProblemDetailEquals, headerValue, jsonField, optionalHeaderValue,
}

final class HttpAppSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  private val app = ResourceFunFixture(httpAppResource("momo-api-http"))
  private val prodHstsApp = ResourceFunFixture(prodHttpAppResource("momo-api-prod-hsts"))
  private val prodHttpApp = ResourceFunFixture(prodHttpAppResource("momo-api-prod-http"))
  private val prodOpenApiApp = ResourceFunFixture(prodHttpAppResource("momo-api-prod-openapi"))
  private val uploadLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-upload-limit",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(uploadRequestMaxBytes = 1L)),
  ))
  private val exportRateLimitApp = ResourceFunFixture(configuredHttpAppResource(
    "momo-api-export-rate",
    _.copy(resourceLimits = ResourceLimitsConfig.defaults.copy(exportRateLimitPerMinute = 0)),
  ))

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
        }
      }
  }

  app.test("GET /api/auth/me authenticates fixed dev member") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/auth/me").putHeaders(devReadHeader())
    httpApp.run(request).flatMap { response =>
      response.as[Json].map { body =>
        assertEquals(response.status, Status.Ok)
        assertEquals(jsonField[String](body, "memberId"), "ponta")
        assertEquals(jsonField[String](body, "csrfToken"), "dev")
      }
    }
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
      assert(header("Permissions-Policy").exists(_.contains("camera=()")))
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
    .test("prod protected endpoint rejects external X-Dev-User without session cookie") { httpApp =>
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

  prodOpenApiApp.test("prod /openapi.yaml is protected by session middleware") { httpApp =>
    httpApp.run(Request[IO](Method.GET, uri"/openapi.yaml")).flatMap(response =>
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

  exportRateLimitApp.test("export endpoint applies per-member rate limits") { httpApp =>
    val request = Request[IO](Method.GET, uri"/api/exports/matches?format=tsv")
      .putHeaders(devReadHeader())
    httpApp.run(request).flatMap(response =>
      assertProblem(response, Status.TooManyRequests, "TOO_MANY_REQUESTS", "Too many exports")
    )
  }
