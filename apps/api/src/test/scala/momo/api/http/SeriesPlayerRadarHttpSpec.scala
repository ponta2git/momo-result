package momo.api.http

import java.time.Instant

import cats.syntax.all.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Status, Uri}

import momo.api.domain.GameTitle
import momo.api.domain.ids.GameTitleId
import momo.api.http.HttpAssertions.{assertProblem, jsonField}
import momo.api.integration.PostgresHttpAppTestFixtures

final class SeriesPlayerRadarHttpSpec extends PostgresHttpAppTestFixtures:
  private val title = GameTitleId.unsafeFromString("title-radar-http")
  private val stateUri =
    Uri.unsafeFromString(s"/api/admin/series-analysis/radar?gameTitleId=${title.value}")
  private val operationsUri = uri"/api/admin/series-analysis/radar/operations"
  private val app = ResourceFunFixture(seededWiredHttpAppResource(
    "radar-http",
    runtime =>
      runtime.gameTitles.createWithNextDisplayOrder(GameTitle(
        title,
        "レーダー作品",
        "momotetsu2",
        1,
        Instant.parse("2026-09-29T00:00:00Z")
      )).void
  ))

  app.test(
    "a lost candidate response is replayed and remains inspectable after leaving the screen"
  ) { http =>
    val command = Json.obj(
      "gameTitleId" -> Json.fromString(title.value),
      "kind" -> Json.fromString("candidate")
    )
    for
      accepted <- http.run(writePost(operationsUri, command, Some("radar-replay")))
      first <- accepted.as[Json]
      replay <- http.run(writePost(operationsUri, command, Some("radar-replay")))
      repeated <- replay.as[Json]
      state <- http.run(readGet(stateUri)).flatMap(_.as[Json])
      operationId = jsonField[String](first, "operationId")
      observed <- http.run(readGet(Uri.unsafeFromString(
        s"/api/admin/series-analysis/radar/operation?gameTitleId=${title.value}&operationId=$operationId"
      )))
        .flatMap(_.as[Json])
      candidateId =
        first.hcursor.get[String]("candidateId").getOrElse(fail("missing candidate identity"))
      guarded <- http.run(writePost(
        operationsUri,
        command.mapObject(_.add("kind", Json.fromString("withdraw"))
          .add("candidateId", Json.fromString(candidateId))
          .add("originOperationId", Json.fromString(operationId))),
        Some("radar-guarded-withdraw")
      ))
      _ <- assertProblem(guarded, Status.Conflict, "CONFLICT", "saved candidate")
      retained <- http.run(readGet(stateUri)).flatMap(_.as[Json])
      withdrawn <- http.run(writePost(
        operationsUri,
        command.mapObject(_.add("kind", Json.fromString("withdraw"))
          .add("candidateId", Json.fromString(candidateId))),
        Some("radar-withdraw")
      ))
      after <- http.run(readGet(stateUri)).flatMap(_.as[Json])
    yield
      assertEquals(accepted.status, Status.Accepted)
      assertEquals(repeated, first)
      assertEquals(observed, first)
      assertEquals(
        state.hcursor.downField("candidate").get[String]("candidateId"),
        Right(candidateId)
      )
      assertEquals(state.hcursor.get[List[Json]]("operations").map(_.size), Right(1))
      assertEquals(state.hcursor.downField("currentBasis").focus, Some(Json.Null))
      assertEquals(retained.hcursor.downField("candidate").get[String]("status"), Right("pending"))
      assertEquals(withdrawn.status, Status.Accepted)
      assertEquals(after.hcursor.downField("candidate").get[String]("status"), Right("withdrawn"))
      assertEquals(after.hcursor.downField("currentBasis").focus, Some(Json.Null))
  }

  app.test("radar administration requires operator access and mutation idempotency") { http =>
    val command = Json.obj(
      "gameTitleId" -> Json.fromString(title.value),
      "kind" -> Json.fromString("candidate")
    )
    for
      deniedRead <- http.run(readGet(stateUri, "account_akane_mami"))
      _ <- assertProblem(deniedRead, Status.Forbidden, "FORBIDDEN", "Operator access")
      deniedWrite <- http.run(writePost(operationsUri, command, "account_akane_mami"))
      _ <- assertProblem(deniedWrite, Status.Forbidden, "FORBIDDEN", "Operator access")
      missingKey <- http.run(writePost(operationsUri, command))
      _ <- assertProblem(
        missingKey,
        Status.UnprocessableContent,
        "VALIDATION_FAILED",
        "Idempotency-Key is required"
      )
    yield ()
  }

  app.test("apply cannot bypass the saved comparison and irrelevant command fields are rejected") {
    http =>
      val commands = List(
        Json.obj(
          "gameTitleId" -> Json.fromString(title.value),
          "kind" -> Json.fromString("apply"),
          "candidateId" -> Json.fromString("candidate-without-preview")
        ),
        Json.obj(
          "gameTitleId" -> Json.fromString(title.value),
          "kind" -> Json.fromString("candidate"),
          "previewId" -> Json.fromString("unrelated-preview")
        ),
      )
      commands.zipWithIndex.traverse_ { case (body, index) =>
        http.run(writePost(operationsUri, body, Some(s"radar-invalid-$index"))).flatMap(response =>
          assertProblem(
            response,
            Status.UnprocessableContent,
            "VALIDATION_FAILED",
            "Invalid fields"
          )
        )
      }
  }

  app.test("scope resolution is a member read and reports empty separately from invalid identity") {
    http =>
      val base = s"/api/analytics/series-comparison/v2/scope-status?gameTitleId=${title.value}"
      for
        empty <-
          http.run(readGet(Uri.unsafeFromString(base), "account_akane_mami")).flatMap(_.as[Json])
        invalid <- http.run(
          readGet(Uri.unsafeFromString(s"$base&mapMasterId=unknown-map"))
        ).flatMap(_.as[Json])
      yield
        assertEquals(jsonField[String](empty, "state"), "empty")
        assertEquals(jsonField[String](invalid, "state"), "invalid")
        assertEquals(invalid.hcursor.get[List[String]]("invalidFields"), Right(List("mapMasterId")))
  }

  app.test("history validates its bounds and requires operator permission") { http =>
    val history = uri"/api/admin/series-analysis/radar/revisions"
    for
      denied <- http.run(readGet(history, "account_akane_mami"))
      _ <- denied.body.compile.drain
      invalid <- http.run(readGet(Uri.unsafeFromString(history.toString + "?limit=51")))
      _ <- invalid.body.compile.drain
      allowed <- http.run(readGet(history))
      body <- allowed.as[Json]
    yield
      assertEquals(denied.status, Status.Forbidden)
      assertEquals(invalid.status, Status.UnprocessableContent)
      assertEquals(allowed.status, Status.Ok, body.noSpaces)
  }
