package momo.api.adapters.postgres

import cats.effect.Async
import cats.syntax.all.*
import doobie.Transactor
import doobie.implicits.*

import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.maintenance.DatabaseConnectionProof

/** Read-only readiness against the existing publication contract; no capability registration. */
private[api] object MaintenanceReadiness:
  def check[F[_]: Async](
      transactor: Transactor[F],
      configuredUrl: String,
  ): F[DatabaseConnectionProof] =
    Async[F].delay(SeriesAnalysisPayloadValidator.ensureReady()) *>
      (for
        _ <- sql"""
        SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
        SET LOCAL statement_timeout = '3s';
        SET LOCAL lock_timeout = '1s'
      """.update.run
        current <- sql"""
          SELECT artifact_schema_version, validation_contract_id
          FROM series_analysis_release_state WHERE singleton_key = 'current'
        """.query[(Int, Option[String])].option
        _ <- Either.cond(
          current.forall { case (schemaVersion, validationContractId) =>
            SeriesAnalysisArtifactContract.supports(schemaVersion, validationContractId)
          },
          (),
          new IllegalStateException("Reader contract is incompatible.")
        )
          .liftTo[doobie.ConnectionIO]
        identity <- sql"""
        SELECT current_database(), row_security_active('drizzle.__drizzle_migrations'::regclass)
      """.query[(String, Boolean)].unique
        (database, filtered) = identity
        _ <- Either.cond(
          !filtered,
          (),
          new IllegalStateException("Database proof requires an unfiltered ledger.")
        )
          .liftTo[doobie.ConnectionIO]
        ledger <- sql"""
        SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id
      """.query[DatabaseConnectionProof.LedgerRow].to[List]
        proof <- DatabaseConnectionProof.fromSnapshot(configuredUrl, database, ledger)
          .liftTo[doobie.ConnectionIO]
      yield proof).transact(transactor)
