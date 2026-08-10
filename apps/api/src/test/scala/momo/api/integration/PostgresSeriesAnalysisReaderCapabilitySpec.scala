package momo.api.integration

import cats.effect.IO
import doobie.implicits.*
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.adapters.postgres.PostgresSeriesAnalysisReaderCapability

final class PostgresSeriesAnalysisReaderCapabilitySpec extends IntegrationSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  test("reader capability is active while the API resource is held and drains on release"):
    for
      active <- PostgresSeriesAnalysisReaderCapability.resource[IO](transactor)
        .use(_ => capabilityRow)
      draining <- capabilityRow
    yield
      assertEquals(active, ("[1]", false))
      assertEquals(draining, ("[1]", true))

  private def capabilityRow: IO[(String, Boolean)] = sql"""
    SELECT artifact_schema_versions::text, draining
    FROM series_analysis_reader_capabilities
  """.query[(String, Boolean)].unique.transact(transactor)
