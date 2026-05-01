package momo.api.http

import cats.effect.{IO, Resource}
import io.circe.Json
import java.nio.file.Files
import momo.api.config.{AppConfig, AppEnv}
import momo.api.MomoCatsEffectSuite
import org.http4s.{Method, Request, Status}
import org.http4s.circe.*
import org.http4s.implicits.*

final class HttpAppSpec extends MomoCatsEffectSuite:
  private def app = Resource.eval(IO.blocking(Files.createTempDirectory("momo-api-http")))
    .flatMap { dir =>
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
          assertEquals(body.hcursor.get[String]("status"), Right("ok"))
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
          assertEquals(body.hcursor.get[String]("memberId"), Right("ponta"))
          assertEquals(body.hcursor.get[String]("csrfToken"), Right("dev"))
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
      httpApp.run(request).map(response => assertEquals(response.status, Status.Forbidden))
    }
  }

  test("protected endpoint without auth header returns 401") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/api/auth/me"))
        .map(response => assertEquals(response.status, Status.Unauthorized))
    }
  }

  test("security headers baseline is present on responses (non-prod)") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
        def header(name: String): Option[String] = response.headers
          .get(org.typelevel.ci.CIString(name)).map(_.head.value)
        assertEquals(header("X-Content-Type-Options"), Some("nosniff"))
        assertEquals(header("X-Frame-Options"), Some("DENY"))
        assertEquals(header("Referrer-Policy"), Some("no-referrer"))
        assert(header("Permissions-Policy").exists(_.contains("camera=()")))
        val csp = header("Content-Security-Policy").getOrElse("")
        assert(csp.contains("default-src 'self'"), s"missing default-src in $csp")
        assert(csp.contains("frame-ancestors 'none'"), s"missing frame-ancestors in $csp")
        assert(csp.contains("object-src 'none'"), s"missing object-src in $csp")
        assertEquals(header("Strict-Transport-Security"), None, "HSTS must not be set outside prod")
      }
    }
  }

  test("HSTS is set on prod responses") {
    Resource.eval(IO.blocking(Files.createTempDirectory("momo-api-prod-hsts"))).flatMap { dir =>
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
        val hsts = response.headers.get(org.typelevel.ci.CIString("Strict-Transport-Security"))
        assert(hsts.isDefined, "expected HSTS header in prod")
        val value = hsts.get.head.value
        assert(value.contains("max-age=31536000"), s"unexpected HSTS value: $value")
        assert(value.contains("includeSubDomains"), s"unexpected HSTS value: $value")
      }
    }
  }

  test("X-Request-Id is generated when not provided and echoed in the response") {
    app.use { httpApp =>
      httpApp.run(Request[IO](Method.GET, uri"/healthz")).map { response =>
        val header = response.headers.get(org.typelevel.ci.CIString("X-Request-Id"))
        assert(header.isDefined, "expected X-Request-Id header to be present")
        val value = header.get.head.value
        assert(value.matches("^[A-Za-z0-9_-]{1,64}$"), s"expected UUID-like id, got: $value")
      }
    }
  }

  test("X-Request-Id from the client is preserved when it matches the safe pattern") {
    app.use { httpApp =>
      val request = Request[IO](Method.GET, uri"/healthz")
        .putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("X-Request-Id"), "abc-123_DEF"))
      httpApp.run(request).map { response =>
        val header = response.headers.get(org.typelevel.ci.CIString("X-Request-Id"))
        assertEquals(header.map(_.head.value), Some("abc-123_DEF"))
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
        val value = response.headers.get(org.typelevel.ci.CIString("X-Request-Id"))
          .map(_.head.value).getOrElse("")
        assert(
          value != "bad value with spaces\nand newline",
          "unsafe X-Request-Id should not be echoed verbatim",
        )
        assert(value.matches("^[A-Za-z0-9_-]{1,64}$"))
      }
    }
  }

  test("prod protected endpoint rejects external X-Dev-User without session cookie") {
    Resource.eval(IO.blocking(Files.createTempDirectory("momo-api-prod-http"))).flatMap { dir =>
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
      httpApp.run(request).map(response => assertEquals(response.status, Status.Unauthorized))
    }
  }
