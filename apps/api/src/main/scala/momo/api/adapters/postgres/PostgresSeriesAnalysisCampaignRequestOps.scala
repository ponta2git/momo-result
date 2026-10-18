package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresSeriesAnalysisRequestSupport.{
  lockAndFindOperation,
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
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    lockAndFindOperation(requestedBy, "all_titles", idempotencyKeyHash).flatMap {
      case Some(value) => acceptedForExisting(value)
      case None => create(requestedBy, idempotencyKeyHash, operationId, campaignId)
    }

  private def acceptedForExisting(
      operation: OperationRow
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = sql"""
    SELECT ${identities.wireId(
      "c"
    )} FROM series_analysis_campaigns c WHERE operation_request_id = ${identities.lookup(
      Entity.AnalysisOperations,
      operation.id
    )}
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
  )(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    for
      allocatedOperation <- identities.newId(operationId)
      allocatedCampaign <- identities.newId(campaignId)
      account <- identities.requireReference(Entity.Accounts, requestedBy.value)
      result <- sql"""
    WITH targets AS MATERIALIZED (
      SELECT s.game_title_id, ${identities.wireId("gt")} AS wire_game_title_id,
             s.input_revision, s.algorithm_version, s.artifact_schema_version, s.validation_contract_id
      FROM series_analysis_title_states s JOIN game_titles gt ON gt.id = s.game_title_id
      ORDER BY ${identities.wireId("gt")}
      FOR UPDATE OF s
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
        ${identities.idColumns}, scope, requested_by_account_id, idempotency_key_hash,
        endpoint, status, target_count, accepted_at
      )
      SELECT $allocatedOperation, 'all_titles', $account, $idempotencyKeyHash,
             'all_titles', 'running', target_count, now()
      FROM summary WHERE target_count > 0 AND supported
      RETURNING id, target_count, accepted_at
    ), campaign AS (
      INSERT INTO series_analysis_campaigns (
        ${identities.idColumns}, operation_request_id, trigger, algorithm_version,
        artifact_schema_version, validation_contract_id,
        status, target_count, accepted_at
      )
      SELECT $allocatedCampaign, operation.id, 'manual', summary.algorithm_version,
             ${SeriesAnalysisArtifactContract.ArtifactSchemaVersion},
             ${SeriesAnalysisArtifactContract.ValidationContractId},
             'expanding', operation.target_count, operation.accepted_at
      FROM operation CROSS JOIN summary
      RETURNING id, accepted_at
    ), snapshots AS (
      INSERT INTO series_analysis_campaign_targets (
        campaign_id, game_title_id ${identities.legacyColumn(
          "game_title_id"
        )}, input_revision, algorithm_version,
        artifact_schema_version, validation_contract_id, status, job_request_id, accepted_at
      )
      SELECT campaign.id, targets.game_title_id ${identities.legacyValue(
          fr"targets.wire_game_title_id"
        )}, targets.input_revision,
             targets.algorithm_version, targets.artifact_schema_version,
             targets.validation_contract_id, 'pending', NULL, campaign.accepted_at
      FROM campaign CROSS JOIN targets
    )
    SELECT summary.target_count, CASE WHEN operation.id IS NULL THEN NULL ELSE $operationId END, operation.accepted_at
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

    yield result

end PostgresSeriesAnalysisCampaignRequestOps
