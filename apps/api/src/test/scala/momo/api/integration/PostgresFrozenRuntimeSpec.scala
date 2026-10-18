package momo.api.integration

import java.nio.file.Files

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.Fragment
import doobie.implicits.*
import org.http4s.{Header, Method, Request, Status, Uri}

import momo.api.adapters.postgres.MaintenanceReadiness
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv, MaintenanceMode}
import momo.api.http.{FrozenHttpApp, RuntimeHttp2ProbeMiddleware}

final class PostgresFrozenRuntimeSpec extends IntegrationSuite:
  private val readinessRequest =
    Request[IO](uri = Uri.unsafeFromString(FrozenHttpApp.ReadinessPath))
      .putHeaders(Header.Raw(
        RuntimeHttp2ProbeMiddleware.HeaderName,
        RuntimeHttp2ProbeMiddleware.HeaderValue,
      ))

  test(
    "frozen acquisition, requests and restart preserve state when the migration ledger is missing"
  ):
    // A regular file cannot serve as image storage. Acquiring frozen must not initialize it.
    Resource.make(IO.blocking(Files.createTempFile("momo-frozen-runtime", ".marker")))(path =>
      IO.blocking(Files.deleteIfExists(path)).void
    ).use { imagePath =>
      val config = AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = imagePath,
        devMemberIds = Nil,
        database = Some(dbFixture().databaseConfig),
        maintenanceMode = MaintenanceMode.Frozen,
      )
      for
        _ <- sql"""
          INSERT INTO app_sessions
            (id_hash, account_id, member_id, csrf_secret_hash, created_at, last_seen_at, expires_at)
          VALUES (repeat('a', 64), 'account_ponta', 'member_ponta', repeat('b', 64),
            now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');
          INSERT INTO oauth_state_consumptions (state_hash, expires_at)
          VALUES (repeat('c', 64), now() - interval '1 day')
        """.update.run.transact(transactor)
        before <- durableState
        _ <- List(1, 2).traverse_ { _ =>
          ApiApp.wired[IO](config).use { runtime =>
            for
              ready <- runtime.app.run(readinessRequest)
              readyBody <- ready.as[String]
              _ =
                assertEquals(ready.status, Status.ServiceUnavailable)
                assertEquals(readyBody, "{\"status\":\"unavailable\",\"mode\":\"frozen\"}")
              _ <- List(
                Method.GET -> "/api/auth/me",
                Method.GET -> "/api/auth/callback",
                Method.POST -> "/api/ocr/jobs",
                Method.POST -> "/api/admin/series-analysis/recalculations",
              ).traverse_ { case (method, path) =>
                runtime.app.run(Request[IO](method, Uri.unsafeFromString(path))).map { response =>
                  assertEquals(response.status, Status.ServiceUnavailable)
                }
              }
            yield ()
          }
        }
        after <- durableState
      yield assertEquals(after, before)
    }

  test("maintenance readiness rejects a missing ledger and incompatible readers"):
    val configuredUrl = dbFixture().databaseConfig.jdbcUrl
    for
      missing <- MaintenanceReadiness.check[IO](transactor, configuredUrl).attempt
      _ = assert(missing.left.toOption.exists {
        case error: java.sql.SQLException => error.getSQLState == "42P01"
        case _ => false
      })
      _ <- sql"""
        UPDATE series_analysis_release_state
        SET validation_contract_id = 'incompatible-fixture-contract'
        WHERE singleton_key = 'current'
      """.update.run.transact(transactor)
      failed <- MaintenanceReadiness.check[IO](transactor, configuredUrl).attempt
    yield assertEquals(
      failed.swap.toOption.map(_.getMessage),
      Some("Reader contract is incompatible.")
    )

  private def durableState: IO[List[(String, String)]] = List(
    "app_sessions",
    "oauth_state_consumptions",
    "idempotency_keys",
    "source_images",
    "ocr_jobs",
    "ocr_submissions",
    "series_analysis_jobs",
    "series_analysis_job_requests",
    "series_analysis_operation_requests",
    "series_analysis_campaigns",
    "series_analysis_reader_capabilities",
    "series_analysis_worker_capabilities",
    "worker_execution_slots",
    "discord_notifications",
  ).traverse { table =>
    // Identifiers come only from the fixed fixture table list above.
    Fragment.const(
      s"SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]') FROM $table t"
    ).query[String].unique.transact(transactor).map(table -> _)
  }
