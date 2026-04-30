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
