package momo.api.integration

import cats.effect.IO
import doobie.implicits.*
import io.circe.Json
import org.http4s.Status
import org.http4s.circe.*
import org.http4s.circe.CirceEntityCodec.*
import org.http4s.implicits.*
import org.postgresql.{PGConnection, PGNotification}

import momo.api.adapters.postgres.PostgresWorkerNotifier
import momo.api.config.{AppConfig, AppEnv}
import momo.api.endpoints.{GameTitleListResponse, GameTitleResponse}
import momo.api.http.HttpAssertions.jsonField
import momo.api.http.HttpRequestBodies

final class PostgresRuntimeCompositionSpec extends PostgresHttpAppTestFixtures:
  test("runtime shares master invalidation and wakes processing workers after durable admission"):
    PostgresNotificationListener.resource(dataSource, PostgresWorkerNotifier.Channel.ProcessingJobs)
      .use { connection =>
        tempDirectory("postgres-runtime-composition").flatMap { directory =>
          runtimeResource(AppConfig(
            appEnv = AppEnv.Test,
            httpHost = "127.0.0.1",
            httpPort = 0,
            imageTmpDir = directory,
            devMemberIds = List("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
          ))
        }.use { wired =>
          val app = wired.runtime.app
          val titleId = "title_runtime_composition"
          val run =
            for
              // The relay sends an initial reconciliation hint. Consume it before the mutation so
              // a missing post-commit wake cannot pass by observing startup traffic instead.
              startup <- notifications(connection)
              _ = assertPayloadlessWake(startup)
              warmHandle <- wired.handles.gameTitles.list
              warmResponse <- app.run(readGet(uri"/api/game-titles"))
              warmHttp <- warmResponse.as[GameTitleListResponse]
              _ =
                assertEquals(warmHandle, Nil)
                assertEquals(warmResponse.status, Status.Ok)
                assertEquals(warmHttp.items, Nil)
              createdResponse <- app.run(writePost(
                uri"/api/game-titles",
                HttpRequestBodies.Master.createGameTitle(
                  titleId,
                  "Runtime composition",
                  "momotetsu2"
                ),
                Some("runtime-title-create"),
              ))
              created <- createdResponse.as[GameTitleResponse]
              fromHandle <- wired.handles.gameTitles.list
              freshResponse <- app.run(readGet(uri"/api/game-titles"))
              fromHttp <- freshResponse.as[GameTitleListResponse]
              _ =
                assertEquals(createdResponse.status, Status.Ok)
                assertEquals(created.id, titleId)
                assertEquals(fromHandle.map(_.id.value), List(titleId))
                assertEquals(fromHandle.map(_.name), List(created.name))
                assertEquals(freshResponse.status, Status.Ok)
                assertEquals(fromHttp.items, List(created))
              acceptedResponse <- app.run(writePost(
                uri"/api/admin/series-analysis/recalculations",
                Json.obj("gameTitleId" -> Json.fromString(titleId)),
                Some("runtime-analysis-request"),
              ))
              accepted <- acceptedResponse.as[Json]
              wake <- notifications(connection)
              _ =
                assertEquals(acceptedResponse.status, Status.Accepted)
                assertPayloadlessWake(wake)
              jobId = jsonField[String](jsonField[Json](accepted, "target"), "jobId")
              requestId = jsonField[String](accepted, "requestId")
              saved <- sql"""
              SELECT j.id, j.status, r.operation_request_id, r.status
              FROM series_analysis_jobs j
              JOIN series_analysis_job_requests r ON r.assigned_job_id = j.id
              WHERE j.game_title_id = $titleId
            """.query[(String, String, String, String)].to[List].transact(transactor)
            yield assertEquals(saved, List((jobId, "queued", requestId, "pending")))
          run.race(wired.runtime.backgroundFailure).void
        }
      }

  private def notifications(connection: java.sql.Connection): IO[List[PGNotification]] =
    IO.blocking(
      Option(connection.unwrap(classOf[PGConnection]).getNotifications(5000)).toList.flatten
    )

  private def assertPayloadlessWake(notifications: List[PGNotification]): Unit =
    assert(notifications.nonEmpty, "runtime did not notify processing workers")
    assert(notifications.forall(_.getName == PostgresWorkerNotifier.Channel.ProcessingJobs.value))
    assert(notifications.forall(_.getParameter.isEmpty))
