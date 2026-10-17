package momo.api.adapters.postgres

import cats.effect.Async
import cats.syntax.all.*
import doobie.Transactor
import doobie.implicits.*

import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract

/** Read-only readiness against the existing publication contract; no capability registration. */
private[api] object MaintenanceReadiness:
  def check[F[_]: Async](transactor: Transactor[F]): F[Unit] =
    Async[F].delay(SeriesAnalysisPayloadValidator.ensureReady()) *> (
      sql"""
        SET TRANSACTION READ ONLY;
        SET LOCAL statement_timeout = '3s';
        SET LOCAL lock_timeout = '1s'
      """.update.run *>
        sql"""
          SELECT artifact_schema_version, validation_contract_id
          FROM series_analysis_release_state WHERE singleton_key = 'current'
        """.query[(Int, Option[String])].option
    ).transact(transactor).flatMap { current =>
      if current.forall { case (schemaVersion, validationContractId) =>
          SeriesAnalysisArtifactContract.supports(schemaVersion, validationContractId)
        }
      then Async[F].unit
      else Async[F].raiseError(new IllegalStateException("Reader contract is incompatible."))
    }
