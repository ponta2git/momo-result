package momo.api.http

import cats.effect.IO
import cats.syntax.all.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status}

import momo.api.MomoCatsEffectSuite
import momo.api.http.HttpAssertions.assertProblem

final class NotificationSettingsHttpSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  private val app = ResourceFunFixture(httpAppResource("momo-api-notification-settings"))
  private val uri = uri"/api/admin/notification-settings"

  private def request(ocr: Boolean, analysis: Boolean): Json = request(ocr, analysis, "0", "0")

  private def request(ocr: Boolean, analysis: Boolean, ocrGeneration: String): Json = request(ocr, analysis, ocrGeneration, "0")

  private def request(ocr: Boolean, analysis: Boolean, ocrGeneration: String, analysisGeneration: String): Json =
    Json.obj(
      "ocrCompleted" -> Json.obj("enabled" -> Json.fromBoolean(ocr), "expectedGeneration" -> Json.fromString(ocrGeneration)),
      "analysisCompleted" -> Json.obj("enabled" -> Json.fromBoolean(analysis), "expectedGeneration" -> Json.fromString(analysisGeneration)),
    )

  app.test("only administrators can read and save global notification settings; writes require CSRF") { http =>
    for
      anonymous <- http.run(Request[IO](Method.GET, uri))
      _ <- assertProblem(anonymous, Status.Unauthorized, "UNAUTHORIZED", "account")
      reader <- http.run(readGet(uri, "account_eu"))
      _ <- assertProblem(reader, Status.Forbidden, "FORBIDDEN", "admin")
      writer <- http.run(writeRequest(Method.PUT, uri, "account_eu").withEntity(request(false, false)))
      _ <- assertProblem(writer, Status.Forbidden, "FORBIDDEN", "admin")
      noCsrf <- http.run(readRequest(Method.PUT, uri).withEntity(request(false, false)))
      _ <- assertProblem(noCsrf, Status.Forbidden, "FORBIDDEN", "CSRF")
      saved <- http.run(readGet(uri)).flatMap(_.as[Json])
    yield assertEquals(saved.hcursor.downField("ocrCompleted").get[Boolean]("enabled"), Right(true))
  }

  app.test("save returns both confirmed settings, persists on the next read, and safely replays") { http =>
    val write = writeRequest(Method.PUT, uri, Some("notification-settings-save")).withEntity(request(false, true))
    for
      first <- http.run(write)
      body <- first.as[Json]
      replay <- http.run(write).flatMap(_.as[Json])
      read <- http.run(readGet(uri)).flatMap(_.as[Json])
    yield
      assertEquals(first.status, Status.Ok)
      assertEquals(body, Json.obj(
        "ocrCompleted" -> Json.obj("enabled" -> Json.False, "generation" -> Json.fromString("1")),
        "analysisCompleted" -> Json.obj("enabled" -> Json.True, "generation" -> Json.fromString("0")),
      ))
      assertEquals(replay, body)
      assertEquals(read, body)
  }

  app.test("a stale expected generation rejects the entire form without changing either setting") { http =>
    for
      _ <- http.run(writeRequest(Method.PUT, uri).withEntity(request(false, true)))
      before <- http.run(readGet(uri)).flatMap(_.as[Json])
      stale <- http.run(writeRequest(Method.PUT, uri).withEntity(request(true, false)))
      _ <- assertProblem(stale, Status.Conflict, "NOTIFICATION_SETTINGS_VERSION_CONFLICT", "generation")
      after <- http.run(readGet(uri)).flatMap(_.as[Json])
    yield assertEquals(after, before)
  }

  app.test("invalid generation and incomplete or incorrectly typed forms cannot save settings") { http =>
    val invalid = List("-1", "01", "1.0", "9223372036854775808").map(generation => request(false, false, generation)) ++ List(
      Json.obj("ocrCompleted" -> Json.obj("enabled" -> Json.False, "expectedGeneration" -> Json.fromString("0"))),
      request(false, false).mapObject(_.add("ocrCompleted", Json.obj("enabled" -> Json.fromString("false"), "expectedGeneration" -> Json.fromString("0")))),
    )
    for
      before <- http.run(readGet(uri)).flatMap(_.as[Json])
      statuses <- invalid.traverse(body => http.run(writeRequest(Method.PUT, uri).withEntity(body)).map(_.status))
      after <- http.run(readGet(uri)).flatMap(_.as[Json])
    yield
      assertEquals(statuses.map(_.code), List(422, 422, 422, 422, 400, 400))
      assertEquals(after, before)
  }
end NotificationSettingsHttpSpec
