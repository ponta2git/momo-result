package momo.api.integration

import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.{Header, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.http.MaintenanceHttpApp
import momo.api.testing.TestImages
import momo.api.util.Sha256

final class PostgresDrainingRuntimeSpec extends PostgresHttpAppTestFixtures:
  private val token = "drain-runtime-fixture-00000000000000"
  private val id = "e38a1ea2-3b4f-4c53-af03-c385bb6d0711"
  private val draft = "maintenance-draft"
  private val uploadKey = "maintenance-admitted-upload"
  private val submissionBody = Json.obj(
    "matchDraftId" -> Json.fromString(draft),
    "members" -> Json.arr(Json.obj(
      "screenType" -> Json.fromString("total_assets"),
      "uploadIdempotencyKey" -> Json.fromString(uploadKey),
      "imageSha256" -> Json.fromString(Sha256.hex(TestImages.png1x1)),
      "imageByteLength" -> Json.fromInt(TestImages.png1x1.length),
    )),
  )

  private def drainRequest(stage: String): Request[IO] =
    Request[IO](Method.POST, Uri.unsafeFromString(MaintenanceHttpApp.Path))
      .putHeaders(Header.Raw(CIString("Authorization"), "Bearer " + token))
      .withEntity(Json.obj(
        "cutoverId" -> Json.fromString("runtime-drain"),
        "stopEpoch" -> Json.fromInt(1),
        "stage" -> Json.fromString(stage),
      ))

  private def call(app: TestHttpApp, request: Request[IO]): IO[(Status, Json)] =
    app.run(request).flatMap(response => response.as[Json].map(response.status -> _))

  private def waitDrained(app: TestHttpApp): IO[Unit] =
    val request = Request[IO](uri = Uri.unsafeFromString(MaintenanceHttpApp.Path))
      .putHeaders(Header.Raw(CIString("Authorization"), "Bearer " + token))
    def loop: IO[Unit] = call(app, request).flatMap { (_, json) =>
      if json.hcursor.get[String]("phase") == Right("drained") then IO.unit
      else IO.sleep(5.millis) *> loop
    }
    loop.timeout(10.seconds)

  test("live admission drains only new work, then all settles the real API runtime"):
    configuredHttpAppResource(
      "momo-api-drain",
      config =>
        config.copy(
          maintenanceOperationsToken = Some(token),
          resourceLimits = config.resourceLimits.copy(
            sessionPruneInterval = 20.millis,
            imageOrphanReaperInterval = 20.millis,
          ),
        )
    ).use { app =>
      for
        _ <- sql"""INSERT INTO match_drafts (id, created_by_account_id, status)
          VALUES ($draft, 'account_ponta', 'draft_ready')""".update.run.transact(transactor)
        accepted <- call(
          app,
          writeRequest(Method.PUT, Uri.unsafeFromString("/api/ocr-submissions/" + id))
            .withEntity(submissionBody)
        )
        admission <- call(app, drainRequest("admission"))
        _ <- waitDrained(app)
        rejected <- call(
          app,
          writeRequest(
            Method.PUT,
            Uri.unsafeFromString("/api/ocr-submissions/" + UUID.randomUUID().toString)
          ).withEntity(submissionBody)
        )
        replay <- call(
          app,
          writeRequest(Method.PUT, Uri.unsafeFromString("/api/ocr-submissions/" + id))
            .withEntity(submissionBody)
        )
        foreignUpload <- uploadPngRequestWithIdempotency("unadmitted-upload").flatMap(call(app, _))
        upload <- uploadPngRequestWithIdempotency(uploadKey).flatMap(call(app, _))
        imageId <- upload._2.hcursor.get[String]("imageId").liftTo[IO]
        job <- call(
          app,
          writePost(
            Uri.unsafeFromString("/api/ocr-jobs"),
            Json.obj(
              "imageId" -> Json.fromString(imageId),
              "requestedScreenType" -> Json.fromString("total_assets"),
              "submissionId" -> Json.fromString(id),
            )
          )
        )
        closedBusiness <- call(app, readGet(Uri.unsafeFromString("/api/auth/me")))
        all <- call(app, drainRequest("all"))
        _ <- waitDrained(app)
        capabilities <- sql"SELECT bool_and(draining) FROM series_analysis_reader_capabilities"
          .query[Boolean].unique.transact(transactor)
        // Cleanup would remove these immediately if any normal periodic writer survived all.
        _ <- sql"""INSERT INTO oauth_state_consumptions (state_hash, expires_at)
          VALUES (repeat('d',64), now() - interval '1 day')""".update.run.transact(transactor)
        closedContinuation <- call(app, readGet(Uri.unsafeFromString("/api/ocr-submissions/" + id)))
        _ <- IO.sleep(100.millis)
        expired <-
          sql"SELECT count(*) FROM oauth_state_consumptions WHERE state_hash = repeat('d',64)"
            .query[Long].unique.transact(transactor)
        submissions <-
          sql"SELECT count(*) FROM ocr_submissions".query[Long].unique.transact(transactor)
        images <- sql"SELECT count(*) FROM source_images".query[Long].unique.transact(transactor)
        jobs <-
          sql"SELECT count(*) FROM ocr_jobs WHERE status = 'queued'".query[Long].unique.transact(
            transactor
          )
      yield
        assertEquals(accepted._1, Status.Ok)
        assertEquals(admission._1, Status.Accepted)
        assertEquals(rejected._1, Status.ServiceUnavailable)
        assertEquals(replay._1, Status.Ok)
        assertEquals(
          replay._2.hcursor.get[String]("admissionDeadline"),
          accepted._2.hcursor.get[String]("admissionDeadline")
        )
        assertEquals(foreignUpload._1, Status.ServiceUnavailable)
        assertEquals(upload._1, Status.Ok)
        assertEquals(job._1, Status.Ok)
        assertEquals(closedBusiness._1, Status.ServiceUnavailable)
        assertEquals(all._1, Status.Accepted)
        assert(capabilities)
        assertEquals(closedContinuation._1, Status.ServiceUnavailable)
        assertEquals((expired, submissions, images, jobs), (1L, 1L, 1L, 1L))
    }
