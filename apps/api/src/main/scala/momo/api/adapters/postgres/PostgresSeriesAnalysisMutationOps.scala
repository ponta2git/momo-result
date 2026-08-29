package momo.api.adapters.postgres

import cats.MonadThrow
import cats.syntax.all.*
import doobie.ConnectionIO
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.GameTitleId

/**
 * Adds a durable series-analysis intent to the same transaction as a confirmed-match mutation.
 *
 * IDs for automatic work are derived from the title revision. A transaction retry therefore
 * converges on the same rows, while each committed match mutation receives a new revision.
 */
private[postgres] object PostgresSeriesAnalysisMutationOps:
  private final case class DesiredVersion(
      inputRevision: Long,
      algorithmVersion: String,
      artifactSchemaVersion: Int,
      validationContractId: Option[String],
  )

  private final case class ActiveJob(id: String, status: String)

  def enqueueMatchMutation(gameTitleIds: List[GameTitleId]): ConnectionIO[Unit] = gameTitleIds
    .distinct.sortBy(_.value).traverse_(enqueueTitle)

  private def enqueueTitle(gameTitleId: GameTitleId): ConnectionIO[Unit] =
    for
      desired <- sql"""
        UPDATE series_analysis_title_states
        SET input_revision = input_revision + 1,
            pending_work = true,
            updated_at = now()
        WHERE game_title_id = $gameTitleId
        RETURNING input_revision, algorithm_version, artifact_schema_version,
                  validation_contract_id
      """.query[DesiredVersion].option.flatMap {
        case Some(value) => value.pure[ConnectionIO]
        case None => MonadThrow[ConnectionIO].raiseError(
            PostgresDataIntegrityException.inconsistentRow(
              "series_analysis_title_states",
              gameTitleId.value,
              "missing title state while recording a confirmed-match mutation",
            )
          )
      }
      active <- sql"""
        SELECT id, status
        FROM series_analysis_jobs
        WHERE game_title_id = $gameTitleId
          AND status IN ('queued', 'running')
        FOR UPDATE
      """.query[ActiveJob].option
      derivedJobId = stableId(
        "analysis-job",
        gameTitleId.value,
        desired.inputRevision.toString,
        desired.algorithmVersion,
        desired.artifactSchemaVersion.toString,
        validationContractIdentity(desired.validationContractId),
      )
      jobId = active.fold(derivedJobId)(_.id)
      requestId = stableId(
        "analysis-request",
        gameTitleId.value,
        desired.inputRevision.toString,
        desired.algorithmVersion,
        desired.artifactSchemaVersion.toString,
        validationContractIdentity(desired.validationContractId),
      )
      _ <- active match
        case None => sql"""
            INSERT INTO series_analysis_jobs (
              id,
              game_title_id,
              input_revision,
              algorithm_version,
              artifact_schema_version,
              validation_contract_id,
              status,
              trigger
            ) VALUES (
              $derivedJobId,
              $gameTitleId,
              ${desired.inputRevision},
              ${desired.algorithmVersion},
              ${desired.artifactSchemaVersion},
              ${desired.validationContractId},
              'queued',
              'match_mutation'
            )
          """.update.run.void
        case Some(job) if job.status == "queued" =>
          sql"""
            UPDATE series_analysis_jobs
            SET input_revision = ${desired.inputRevision},
                algorithm_version = ${desired.algorithmVersion},
                artifact_schema_version = ${desired.artifactSchemaVersion},
                validation_contract_id = ${desired.validationContractId},
                updated_at = now()
            WHERE id = ${job.id}
              AND status = 'queued'
          """.update.run.flatMap(requireOne("series_analysis_jobs", job.id, "coalesce queued job"))
        case Some(_) => ().pure[ConnectionIO]
      _ <- sql"""
        INSERT INTO series_analysis_job_requests (
          id,
          game_title_id,
          input_revision,
          algorithm_version,
          artifact_schema_version,
          validation_contract_id,
          trigger,
          force_run,
          status,
          assigned_job_id
        ) VALUES (
          $requestId,
          $gameTitleId,
          ${desired.inputRevision},
          ${desired.algorithmVersion},
          ${desired.artifactSchemaVersion},
          ${desired.validationContractId},
          'match_mutation',
          false,
          'pending',
          $jobId
        )
        ON CONFLICT (id) DO NOTHING
      """.update.run.void
      _ <- active match
        case Some(job) if job.status == "running" => ().pure[ConnectionIO]
        case _ =>
          val outboxId = stableId("analysis-outbox", jobId, desired.inputRevision.toString)
          val dedupeKey = s"$jobId:${desired.inputRevision.toString}"
          sql"""
            INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key)
            VALUES ($outboxId, $jobId, $dedupeKey)
            ON CONFLICT (dedupe_key) DO NOTHING
          """.update.run.void
    yield ()

  private def stableId(prefix: String, parts: String*): String =
    val source = parts.mkString("\u001f")
    s"$prefix-${java.util.UUID.nameUUIDFromBytes(source.getBytes(java.nio.charset.StandardCharsets.UTF_8))}"

  private[postgres] def validationContractIdentity(value: Option[String]): String = value match
    case None => "none"
    case Some(contractId) => s"some:$contractId"

  private def requireOne(table: String, id: String, operation: String)(affected: Int)
      : ConnectionIO[Unit] =
    if affected == 1 then ().pure[ConnectionIO]
    else
      MonadThrow[ConnectionIO].raiseError(
        PostgresDataIntegrityException
          .inconsistentRow(table, id, s"expected one row while attempting to $operation")
      )
