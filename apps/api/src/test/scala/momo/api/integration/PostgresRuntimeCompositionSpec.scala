package momo.api.integration

import cats.effect.{IO, Resource}
import doobie.implicits.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.circe.CirceEntityCodec.*
import org.http4s.implicits.*
import org.http4s.{Header, Method, Request, Status}
import org.typelevel.ci.CIString

import momo.api.config.{AppConfig, AppEnv, WorkerWakeConfig}
import momo.api.endpoints.{GameTitleListResponse, GameTitleResponse}
import momo.api.http.HttpAssertions.jsonField
import momo.api.http.HttpRequestBodies

final class PostgresRuntimeCompositionSpec extends PostgresHttpAppTestFixtures:
  test("standalone development can edit a freshly migrated database before a Worker is deployed"):
    def createTitle(wake: Option[WorkerWakeConfig]): IO[Status] =
      val previousContract = sql"""
        UPDATE series_analysis_release_state SET validation_contract_id = 'previous-reader-contract'
        WHERE singleton_key = 'current'
      """.update.run.transact(transactor)
      previousContract *> tempDirectory("standalone-api-edit").flatMap { directory =>
        runtimeResource(AppConfig(
          appEnv = AppEnv.Dev,
          httpHost = "127.0.0.1",
          httpPort = 0,
          imageTmpDir = directory,
          devMemberIds = List("member_ponta"),
          workerWake = wake,
        ))
      }.use { wired =>
        wired.runtime.app.run(writePost(
          uri"/api/game-titles",
          HttpRequestBodies.Master.createGameTitle("title_local_edit", "Local edit", "momotetsu2"),
          Some("standalone-title-create"),
        )).map(_.status)
      }
    for
      standalone <- createTitle(None)
      wake <- WorkerWakeConfig.load[IO](Map("WORKER_WAKE_TOKEN" -> ("w" * 32)), AppEnv.Dev)
      coupled <- createTitle(wake)
    yield
      assertEquals(standalone, Status.Ok)
      assertEquals(coupled, Status.ServiceUnavailable)

  test("runtime shares master invalidation and wakes processing workers after durable admission"):
    val credential = "w" * 32
    Resource.eval(WorkerWakeConfig.load[IO](
      Map("WORKER_WAKE_TOKEN" -> credential),
      AppEnv.Test
    )).flatMap { wake =>
      tempDirectory("postgres-runtime-composition").flatMap { directory =>
        runtimeResource(AppConfig(
          workerWake = wake,
          appEnv = AppEnv.Test,
          httpHost = "127.0.0.1",
          httpPort = 0,
          imageTmpDir = directory,
          devMemberIds = List("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
        ))
      }
    }.use { wired =>
      val app = wired.runtime.app
      val titleId = "title_runtime_composition"
      val request = Request[IO](Method.GET, uri"/internal/worker/wake")
        .putHeaders(Header.Raw(CIString("Authorization"), s"Bearer $credential"))
      val privateApp = wired.runtime.workerWakeApp.get
      val run =
        for
          startup <- privateApp.run(request).flatMap(_.as[Json])
          publicProbe <- app.run(request)
          _ = assertEquals(publicProbe.status, Status.NotFound)
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
          wake <- privateApp.run(request).flatMap(_.as[Json])
          _ =
            assertEquals(acceptedResponse.status, Status.Accepted)
            assertEquals(jsonField[String](wake, "boot"), jsonField[String](startup, "boot"))
            assert(jsonField[Long](wake, "cursor") > jsonField[Long](startup, "cursor"))
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
