package momo.api.integration

import cats.data.Kleisli
import cats.effect.IO
import doobie.implicits.*
import org.http4s.{Request, Response, Status, Uri}

import momo.api.adapters.postgres.PostgresSeriesAnalysisReaderCapability

final class PostgresSeriesAnalysisReaderCapabilitySpec extends IntegrationSuite:
  test("reader capability is active while the API resource is held and drains on release"):
    for
      active <- PostgresSeriesAnalysisReaderCapability.resource[IO](transactor)
        .use(_ => capabilityRow)
      draining <- capabilityRow
    yield
      assertEquals(
        active,
        (
          "[11]",
          "[\"series-analysis-artifact-v11-full-validation-v2\"]",
          false
        ),
      )
      assertEquals(
        draining,
        (
          "[11]",
          "[\"series-analysis-artifact-v11-full-validation-v2\"]",
          true
        ),
      )

  test("a waiting candidate is admitted only after its active contract is confirmed"):
    val contract =
      momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract.ValidationContractId
    def publish(target: String): IO[Unit] = sql"""
      UPDATE series_analysis_release_state SET validation_contract_id = $target WHERE singleton_key = 'current'
    """.update.run.transact(transactor).void
    publish("previous-reader-contract") *>
      PostgresSeriesAnalysisReaderCapability.resource[IO](transactor).use { reader =>
        val app = reader.guard(Kleisli.pure[IO, Request[IO], Response[IO]](Response[IO](Status.Ok)))
        def status(path: String) =
          app.run(Request[IO](uri = Uri.unsafeFromString(path))).map(_.status)
        for
          pending <- status("/api/matches")
          live <- status("/healthz")
          pendingProof <- reader.attest(requireActive = true).attempt
          _ <- publish(contract)
          before <- status("/api/matches")
          _ <- reader.attest(requireActive = true)
          after <- status("/api/matches")
          _ <- publish("previous-reader-contract")
          _ <- reader.attest(requireActive = false)
          retired <- status("/api/matches")
        yield
          assert(pendingProof.isLeft)
          assertEquals(
            List(pending, live, before, after, retired),
            List(
              Status.ServiceUnavailable,
              Status.Ok,
              Status.ServiceUnavailable,
              Status.Ok,
              Status.ServiceUnavailable
            )
          )
      }

  private def capabilityRow: IO[(String, String, Boolean)] = sql"""
    SELECT artifact_schema_versions::text, validation_contract_ids::text, draining
    FROM series_analysis_reader_capabilities
  """.query[(String, String, Boolean)].unique.transact(transactor)
