package momo.api.adapters.postgres

import cats.MonadThrow
import cats.syntax.all.*
import doobie.ConnectionIO
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.ids.GameTitleId
import momo.api.errors.{AppError, AppException}

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

  private final case class ActiveJob(id: String, status: String, workKind: String)

  def enqueueMatchMutation(gameTitleIds: List[GameTitleId])(using
      identities: PostgresIdentities): ConnectionIO[Unit] = gameTitleIds
    .traverse(id =>
      identities.normalize(Entity.GameTitles, id.value).map(GameTitleId.unsafeFromString)
    )
    .flatMap(_.distinct.sortBy(_.value).traverse_(enqueueTitle))

  private def enqueueTitle(gameTitleId: GameTitleId)(using
      identities: PostgresIdentities): ConnectionIO[Unit] =
    for
      desired <- sql"""
        UPDATE series_analysis_title_states
        SET input_revision = input_revision + 1,
            pending_work = true,
            updated_at = now()
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
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
      _ <-
        if SeriesAnalysisArtifactContract.supports(
            desired.artifactSchemaVersion,
            desired.validationContractId
          )
        then ().pure[ConnectionIO]
        else
          MonadThrow[ConnectionIO].raiseError(new AppException(AppError.AnalysisStateUnavailable()))
      active <- sql"""
        SELECT ${identities.wireId("j")}, status, work_kind
        FROM series_analysis_jobs j
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
          AND status IN ('queued', 'running')
        FOR UPDATE
      """.query[ActiveJob].option
      derivedJobId = stableId(
        "analysis-job",
        gameTitleId.value,
        desired.inputRevision.toString,
        desired.algorithmVersion,
        desired.artifactSchemaVersion.toString,
        SeriesAnalysisArtifactContract.ValidationContractId,
      )
      jobId = active match
        case None => Some(derivedJobId)
        case Some(job) if job.workKind == "analysis" => Some(job.id)
        case Some(_) => None
      requestId = stableId(
        "analysis-request",
        gameTitleId.value,
        desired.inputRevision.toString,
        desired.algorithmVersion,
        desired.artifactSchemaVersion.toString,
        SeriesAnalysisArtifactContract.ValidationContractId,
      )
      allocatedJob <- identities.structuredId(Entity.AnalysisJobs, derivedJobId)
      allocatedRequest <- identities.structuredId(Entity.AnalysisRequests, requestId)
      title <- identities.requireReference(Entity.GameTitles, gameTitleId.value)
      _ <- active match
        case None => sql"""
            INSERT INTO series_analysis_jobs (
              ${identities.idColumns},
              game_title_id,
              input_revision,
              algorithm_version,
              artifact_schema_version,
              validation_contract_id,
              status,
              trigger
            ) VALUES (
              $allocatedJob,
              $title,
              ${desired.inputRevision},
              ${desired.algorithmVersion},
              ${desired.artifactSchemaVersion},
              ${desired.validationContractId},
              'queued',
              'match_mutation'
            )
          """.update.run.void
        case Some(job) if job.status == "queued" && job.workKind == "analysis" =>
          sql"""
            UPDATE series_analysis_jobs
            SET input_revision = ${desired.inputRevision},
                algorithm_version = ${desired.algorithmVersion},
                artifact_schema_version = ${desired.artifactSchemaVersion},
                validation_contract_id = ${desired.validationContractId},
                updated_at = now()
            WHERE id = ${identities.lookup(Entity.AnalysisJobs, job.id)}
              AND status = 'queued'
          """.update.run.flatMap(requireOne("series_analysis_jobs", job.id, "coalesce queued job"))
        case Some(_) => ().pure[ConnectionIO]
      _ <- PostgresSeriesAnalysisJobTransitions.bindQueuedRadar(gameTitleId)
      _ <- sql"""
        INSERT INTO series_analysis_job_requests (
          ${identities.idColumns},
          game_title_id ${identities.legacyColumn("game_title_id")},
          input_revision,
          algorithm_version,
          artifact_schema_version,
          validation_contract_id,
          trigger,
          force_run,
          status,
          assigned_job_id
        ) VALUES (
          $allocatedRequest,
          $title ${identities.legacyValue(gameTitleId.value)},
          ${desired.inputRevision},
          ${desired.algorithmVersion},
          ${desired.artifactSchemaVersion},
          ${desired.validationContractId},
          'match_mutation',
          false,
          'pending',
          ${identities.lookup(Entity.AnalysisJobs, jobId)}
        )
        ON CONFLICT (id) DO NOTHING
      """.update.run.void
    yield ()

  private def stableId(prefix: String, parts: String*): String =
    val source = parts.mkString("\u001f")
    s"$prefix-${java.util.UUID.nameUUIDFromBytes(source.getBytes(java.nio.charset.StandardCharsets.UTF_8))}"

  private def requireOne(table: String, id: String, operation: String)(affected: Int)
      : ConnectionIO[Unit] =
    if affected == 1 then ().pure[ConnectionIO]
    else
      MonadThrow[ConnectionIO].raiseError(
        PostgresDataIntegrityException
          .inconsistentRow(table, id, s"expected one row while attempting to $operation")
      )
