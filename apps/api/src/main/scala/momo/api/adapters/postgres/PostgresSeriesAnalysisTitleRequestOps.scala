package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisRequestSupport.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.domain.{SeriesAnalysisAcceptedTarget, SeriesAnalysisRecalculationAccepted}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisTitleRequestOps:
  def requestTitle(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      ids: List[String],
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = ids match
    case operationId :: requestId :: jobId :: outboxId :: Nil =>
      for
        existing <- existingOperation(requestedBy, "title", idempotencyKeyHash)
        result <- existing match
          case Some(value) => acceptedForExisting(value, gameTitleId)
          case None => create(
              gameTitleId,
              requestedBy,
              idempotencyKeyHash,
              operationId,
              requestId,
              jobId,
              outboxId,
            )
      yield result
    case _ => AppError.Internal("Failed to allocate analysis request identifiers.").asLeft
        .pure[ConnectionIO]

  private def acceptedForExisting(
      operation: OperationRow,
      gameTitleId: GameTitleId,
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = sql"""
    SELECT assigned_job_id
    FROM series_analysis_job_requests
    WHERE operation_request_id = ${operation.id}
      AND game_title_id = $gameTitleId
    ORDER BY accepted_at, id
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
      outboxId: String,
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    for
      desired <- sql"""
        SELECT input_revision, algorithm_version, artifact_schema_version
        FROM series_analysis_title_states
        WHERE game_title_id = $gameTitleId
        FOR UPDATE
      """.query[DesiredRow].option
      active <- sql"""
        SELECT id, status
        FROM series_analysis_jobs
        WHERE game_title_id = $gameTitleId
          AND status IN ('queued', 'running')
        FOR UPDATE
      """.query[ActiveJobRow].option
      result <- desired match
        case None => AppError.NotFound("game title", gameTitleId.value)
            .asLeft[SeriesAnalysisRecalculationAccepted].pure[ConnectionIO]
        case Some(version) => createForDesired(
            gameTitleId,
            requestedBy,
            idempotencyKeyHash,
            operationId,
            requestId,
            newJobId,
            outboxId,
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
      outboxId: String,
      version: DesiredRow,
      active: Option[ActiveJobRow],
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    val accepted = active match
      case None => (Some(newJobId), "created_job")
      case Some(job) if job.status == "queued" => (Some(job.id), "coalesced_into_queued_job")
      case Some(_) => (None, "forced_run_reserved")
    for
      acceptedAt <- sql"SELECT now()".query[Instant].unique
      _ <- sql"""
        INSERT INTO series_analysis_operation_requests (
          id, scope, game_title_id, requested_by_account_id,
          idempotency_key_hash, endpoint, status, target_count, accepted_at
        ) VALUES (
          $operationId, 'title', $gameTitleId, $requestedBy,
          $idempotencyKeyHash, 'title', 'pending', 1, $acceptedAt
        )
      """.update.run.void
      _ <- active match
        case None => insertManualJob(newJobId, gameTitleId, version, acceptedAt)
        case Some(job) if job.status == "queued" => sql"""
            UPDATE series_analysis_jobs
            SET input_revision = ${version.inputRevision},
                algorithm_version = ${version.algorithmVersion},
                artifact_schema_version = ${version.artifactSchemaVersion},
                updated_at = now()
            WHERE id = ${job.id} AND status = 'queued'
          """.update.run.void
        case Some(_) => sql"""
            UPDATE series_analysis_title_states
            SET pending_work = true,
                pending_forced_run_count = pending_forced_run_count + 1,
                updated_at = now()
            WHERE game_title_id = $gameTitleId
          """.update.run.void
      _ <- sql"""
        INSERT INTO series_analysis_job_requests (
          id, game_title_id, operation_request_id, input_revision,
          algorithm_version, artifact_schema_version, trigger,
          force_run, status, assigned_job_id, accepted_at
        ) VALUES (
          $requestId, $gameTitleId, $operationId, ${version.inputRevision},
          ${version.algorithmVersion}, ${version.artifactSchemaVersion}, 'manual',
          true, 'pending', ${accepted._1}, $acceptedAt
        )
      """.update.run.void
      _ <- accepted._1.traverse_(assignedJobId =>
        insertOutbox(outboxId, assignedJobId, s"manual:$requestId")
      )
    yield SeriesAnalysisRecalculationAccepted(
      operationId,
      acceptedAt,
      1,
      None,
      Some(SeriesAnalysisAcceptedTarget(gameTitleId, accepted._1, accepted._2)),
    ).asRight

end PostgresSeriesAnalysisTitleRequestOps
