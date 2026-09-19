package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisRequestSupport.{
  existingOperation,
  OperationRow
}
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.ids.AccountId
import momo.api.domain.{SeriesAnalysisAcceptedCampaign, SeriesAnalysisRecalculationAccepted}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisCampaignRequestOps:
  def requestAll(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      campaignId: String,
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    existingOperation(requestedBy, "all_titles", idempotencyKeyHash).flatMap {
      case Some(value) => acceptedForExisting(value)
      case None => create(requestedBy, idempotencyKeyHash, operationId, campaignId)
    }

  private def acceptedForExisting(
      operation: OperationRow
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = sql"""
    SELECT id FROM series_analysis_campaigns WHERE operation_request_id = ${operation.id}
  """.query[String].option.map(campaignId =>
    SeriesAnalysisRecalculationAccepted(
      operation.id,
      operation.acceptedAt,
      operation.targetCount,
      campaignId.map(SeriesAnalysisAcceptedCampaign(_, "expanding")),
      None,
    ).asRight
  )

  /** Lock and snapshot targets in one statement; only the acceptance crosses the DB boundary. */
  private def create(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      campaignId: String,
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = sql"""
    WITH targets AS MATERIALIZED (
      SELECT game_title_id, input_revision, algorithm_version,
             artifact_schema_version, validation_contract_id
      FROM series_analysis_title_states
      ORDER BY game_title_id
      FOR UPDATE
    ), summary AS (
      SELECT COUNT(*)::int AS target_count,
             CASE WHEN COUNT(DISTINCT algorithm_version) = 1
                  THEN MIN(algorithm_version) ELSE 'mixed' END AS algorithm_version,
             COALESCE(BOOL_AND(
               artifact_schema_version = ${SeriesAnalysisArtifactContract.ArtifactSchemaVersion}
               AND validation_contract_id IS NOT DISTINCT FROM
                 ${SeriesAnalysisArtifactContract.ValidationContractId}
             ), false) AS supported
      FROM targets
    ), operation AS (
      INSERT INTO series_analysis_operation_requests (
        id, scope, requested_by_account_id, idempotency_key_hash,
        endpoint, status, target_count, accepted_at
      )
      SELECT $operationId, 'all_titles', $requestedBy, $idempotencyKeyHash,
             'all_titles', 'running', target_count, now()
      FROM summary WHERE target_count > 0 AND supported
      RETURNING id, target_count, accepted_at
    ), campaign AS (
      INSERT INTO series_analysis_campaigns (
        id, operation_request_id, trigger, algorithm_version,
        artifact_schema_version, validation_contract_id,
        status, target_count, accepted_at
      )
      SELECT $campaignId, operation.id, 'manual', summary.algorithm_version,
             ${SeriesAnalysisArtifactContract.ArtifactSchemaVersion},
             ${SeriesAnalysisArtifactContract.ValidationContractId},
             'expanding', operation.target_count, operation.accepted_at
      FROM operation CROSS JOIN summary
      RETURNING id, accepted_at
    ), snapshots AS (
      INSERT INTO series_analysis_campaign_targets (
        campaign_id, game_title_id, input_revision, algorithm_version,
        artifact_schema_version, validation_contract_id, status, job_request_id, accepted_at
      )
      SELECT campaign.id, targets.game_title_id, targets.input_revision,
             targets.algorithm_version, targets.artifact_schema_version,
             targets.validation_contract_id, 'pending', NULL, campaign.accepted_at
      FROM campaign CROSS JOIN targets
    )
    SELECT summary.target_count, operation.id, operation.accepted_at
    FROM summary LEFT JOIN operation ON true
  """.query[(Int, Option[String], Option[Instant])].unique.map {
    case (0, _, _) => AppError.AnalysisNoEligibleTitles().asLeft
    case (targetCount, Some(id), Some(acceptedAt)) => SeriesAnalysisRecalculationAccepted(
        id,
        acceptedAt,
        targetCount,
        Some(SeriesAnalysisAcceptedCampaign(campaignId, "expanding")),
        None,
      ).asRight
    case _ => AppError.AnalysisStateUnavailable().asLeft
  }

end PostgresSeriesAnalysisCampaignRequestOps
