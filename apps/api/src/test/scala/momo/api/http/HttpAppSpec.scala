package momo.api.http

import cats.effect.IO
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status}

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv}
import momo.api.http.HttpAssertions.{assertProblem, headerValue, jsonField, optionalHeaderValue}

final class HttpAppSpec extends MomoCatsEffectSuite:
  private def app = tempDirectory("momo-api-http").flatMap { dir =>
    val config = AppConfig(
      appEnv = AppEnv.Test,
      httpHost = "127.0.0.1",
      httpPort = 0,
      imageTmpDir = dir,
      devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
    )
    HttpApp.resource[IO](config)
  }

  test("GET /healthz returns ok") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/healthz")).flatMap { response =>
        response.as[Json].map { body =>
          assertEquals(response.status, Status.Ok)
          assertEquals(jsonField[String](body, "status"), "ok")
        }
      }
    }
  }

  test("GET /api/auth/me authenticates fixed dev member") {
    app.use { httpApp =>
      val request = Request[IO](Method.GET, uri"/api/auth/me")
        .putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("X-Dev-User"), "ponta"))
      httpApp.run(request).flatMap { response =>
        response.as[Json].map { body =>
          assertEquals(response.status, Status.Ok)
          assertEquals(jsonField[String](body, "memberId"), "ponta")
          assertEquals(jsonField[String](body, "csrfToken"), "dev")
        }
      }
    }
  }

  test("mutation without development CSRF token is rejected") {
    app.use { httpApp =>
      val request = Request[IO](Method.POST, uri"/api/ocr-jobs")
        .putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("X-Dev-User"), "ponta"))
        .withEntity(Json.obj(
          "imageId" -> Json.fromString("missing"),
          "requestedImageType" -> Json.fromString("auto"),
        ))
      httpApp.run(request)
        .flatMap(response => assertProblem(response, Status.Forbidden, "FORBIDDEN", "CSRF"))
    }
  }

  test("protected endpoint without auth header returns 401") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/api/auth/me")).flatMap(response =>
        assertProblem(response, Status.Unauthorized, "UNAUTHORIZED", "Authentication is required")
      )
    }
  }

  test("security headers baseline is present on responses (non-prod)") {
    app.use { httpApp =>
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
  }

  test("HSTS is set on prod responses") {
    tempDirectory("momo-api-prod-hsts").flatMap { dir =>
      val config = AppConfig(
        appEnv = AppEnv.Prod,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
      )
      HttpApp.resource[IO](config)
    }.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
        val value = headerValue(response, org.typelevel.ci.CIString("Strict-Transport-Security"))
        assert(value.contains("max-age=31536000"), s"unexpected HSTS value: $value")
        assert(value.contains("includeSubDomains"), s"unexpected HSTS value: $value")
      }
    }
  }

  test("X-Request-Id is generated when not provided and echoed in the response") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
        val value = headerValue(response, org.typelevel.ci.CIString("X-Request-Id"))
        assert(value.matches("^[A-Za-z0-9_-]{1,64}$"), s"expected UUID-like id, got: $value")
      }
    }
  }

  test("X-Request-Id from the client is preserved when it matches the safe pattern") {
    app.use { httpApp =>
      val request = Request[IO](Method.GET, uri"/healthz")
        .putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("X-Request-Id"), "abc-123_DEF"))
      httpApp.run(request).map { response =>
        assertEquals(
          optionalHeaderValue(response, org.typelevel.ci.CIString("X-Request-Id")),
          Some("abc-123_DEF"),
        )
      }
    }
  }

  test("malicious X-Request-Id values are replaced with a generated id") {
    app.use { httpApp =>
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
  }

  test("prod protected endpoint rejects external X-Dev-User without session cookie") {
    tempDirectory("momo-api-prod-http").flatMap { dir =>
      val config = AppConfig(
        appEnv = AppEnv.Prod,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = dir,
        devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
      )
      HttpApp.resource[IO](config)
    }.use { httpApp =>
      val request = Request[IO](Method.GET, uri"/api/held-events")
        .putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("X-Dev-User"), "ponta"))
      httpApp.run(request).flatMap(response =>
        assertProblem(response, Status.Unauthorized, "UNAUTHORIZED", "Authentication is required")
      )
    }
  }
