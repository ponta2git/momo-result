package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresSeriesAnalysisRequestSupport.*
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.domain.{SeriesAnalysisAcceptedTarget, SeriesAnalysisRecalculationAccepted}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisTitleRequestOps:
  def requestTitle(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      requestId: String,
      jobId: String,
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    lockAndFindOperation(requestedBy, "title", idempotencyKeyHash).flatMap {
      case Some(value) if !value.gameTitleId.contains(gameTitleId) =>
        AppError.IdempotencyPayloadMismatch(
          "Idempotency-Key was reused for a different game title."
        ).asLeft[SeriesAnalysisRecalculationAccepted].pure[ConnectionIO]
      case Some(value) => acceptedForExisting(value, gameTitleId)
      case None => create(
          gameTitleId,
          requestedBy,
          idempotencyKeyHash,
          operationId,
          requestId,
          jobId,
        )
    }

  private def acceptedForExisting(
      operation: OperationRow,
      gameTitleId: GameTitleId,
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = sql"""
    SELECT ${identities.wireReference(Entity.AnalysisJobs, fr"jr.assigned_job_id")}
    FROM series_analysis_job_requests jr
    WHERE operation_request_id = ${identities.lookup(Entity.AnalysisOperations, operation.id)}
      AND ${identities.retainedMatches("jr", "game_title_id", gameTitleId.value)}
    ORDER BY accepted_at, ${identities.wireId("jr")}
    LIMIT 1
  """.query[Option[String]].option.map { nestedJob =>
    SeriesAnalysisRecalculationAccepted(
      operation.id,
      operation.acceptedAt,
      operation.targetCount,
      None,
      Some(SeriesAnalysisAcceptedTarget(
        gameTitleId,
        nestedJob.flatten,
        "coalesced_into_queued_job",
      )),
    ).asRight
  }

  private def create(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      requestId: String,
      newJobId: String,
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    for
      desired <- sql"""
        SELECT input_revision, algorithm_version, artifact_schema_version,
               validation_contract_id
        FROM series_analysis_title_states
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
        FOR UPDATE
      """.query[DesiredRow].option
      active <- sql"""
        SELECT ${identities.wireId("j")}, status, work_kind
        FROM series_analysis_jobs j
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
          AND status IN ('queued', 'running')
        FOR UPDATE
      """.query[ActiveJobRow].option
      result <- desired match
        case None => AppError.NotFound("game title", gameTitleId.value)
            .asLeft[SeriesAnalysisRecalculationAccepted].pure[ConnectionIO]
        case Some(version)
            if !SeriesAnalysisArtifactContract.supports(
              version.artifactSchemaVersion,
              version.validationContractId
            ) =>
          AppError.AnalysisStateUnavailable().asLeft[
            SeriesAnalysisRecalculationAccepted
          ].pure[ConnectionIO]
        case Some(version) => createForDesired(
            gameTitleId,
            requestedBy,
            idempotencyKeyHash,
            operationId,
            requestId,
            newJobId,
            version,
            active,
          )
    yield result

  private def createForDesired(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      requestId: String,
      newJobId: String,
      version: DesiredRow,
      active: Option[ActiveJobRow],
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    val accepted = active match
      case None => (Some(newJobId), "created_job")
      case Some(job) if job.status == "queued" && job.workKind == "analysis" =>
        (Some(job.id), "coalesced_into_queued_job")
      case Some(_) => (None, "forced_run_reserved")
    for
      allocatedOperation <- identities.newId(operationId)
      allocatedRequest <- identities.newId(requestId)
      title <- identities.requireReference(Entity.GameTitles, gameTitleId.value)
      account <- identities.requireReference(Entity.Accounts, requestedBy.value)
      acceptedAt <- sql"SELECT now()".query[Instant].unique
      _ <- sql"""
        INSERT INTO series_analysis_operation_requests (
          ${identities.idColumns}, scope, game_title_id ${identities.legacyColumn(
          "game_title_id"
        )}, requested_by_account_id,
          idempotency_key_hash, endpoint, status, target_count, accepted_at
        ) VALUES (
          $allocatedOperation, 'title', $title ${identities.legacyValue(
          gameTitleId.value
        )}, $account,
          $idempotencyKeyHash, 'title', 'pending', 1, $acceptedAt
        )
      """.update.run.void
      _ <- active match
        case None => insertManualJob(newJobId, gameTitleId, version, acceptedAt)
        case Some(job) if job.status == "queued" && job.workKind == "analysis" =>
          sql"""
            UPDATE series_analysis_jobs
            SET input_revision = ${version.inputRevision},
                algorithm_version = ${version.algorithmVersion},
                artifact_schema_version = ${version.artifactSchemaVersion},
                validation_contract_id = ${version.validationContractId},
                updated_at = now()
            WHERE id = ${identities.lookup(Entity.AnalysisJobs, job.id)} AND status = 'queued'
          """.update.run.void
        case Some(_) => sql"""
            UPDATE series_analysis_title_states
            SET pending_work = true,
                pending_forced_run_count = pending_forced_run_count + 1,
                updated_at = now()
            WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
          """.update.run.void
      _ <- PostgresSeriesAnalysisJobTransitions.bindQueuedRadar(gameTitleId)
      _ <- sql"""
        INSERT INTO series_analysis_job_requests (
          ${identities.idColumns}, game_title_id ${identities.legacyColumn(
          "game_title_id"
        )}, operation_request_id, input_revision,
          algorithm_version, artifact_schema_version, validation_contract_id, trigger,
          force_run, status, assigned_job_id, accepted_at
        ) VALUES (
          $allocatedRequest, $title ${identities.legacyValue(
          gameTitleId.value
        )}, ${identities.lookup(Entity.AnalysisOperations, operationId)}, ${version.inputRevision},
          ${version.algorithmVersion}, ${version.artifactSchemaVersion},
          ${version.validationContractId}, 'manual',
          true, 'pending', ${identities.lookup(Entity.AnalysisJobs, accepted._1)}, $acceptedAt
        )
      """.update.run.void
    yield SeriesAnalysisRecalculationAccepted(
      operationId,
      acceptedAt,
      1,
      None,
      Some(SeriesAnalysisAcceptedTarget(gameTitleId, accepted._1, accepted._2)),
    ).asRight

end PostgresSeriesAnalysisTitleRequestOps
