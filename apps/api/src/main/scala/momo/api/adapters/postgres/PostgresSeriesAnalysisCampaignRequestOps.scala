package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.update.Update

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisRequestSupport.{
  existingOperation,
  OperationRow
}
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.domain.{SeriesAnalysisAcceptedCampaign, SeriesAnalysisRecalculationAccepted}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisCampaignRequestOps:
  private final case class CampaignTargetRow(
      gameTitleId: GameTitleId,
      inputRevision: Long,
      algorithmVersion: String,
      artifactSchemaVersion: Int,
      validationContractId: Option[String],
  )
  private final case class CampaignTargetSnapshot(
      campaignId: String,
      gameTitleId: GameTitleId,
      inputRevision: Long,
      algorithmVersion: String,
      artifactSchemaVersion: Int,
      validationContractId: Option[String],
      acceptedAt: Instant,
  )

  def requestAll(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      ids: List[String],
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = ids match
    case operationId :: campaignId :: Nil =>
      for
        existing <- existingOperation(requestedBy, "all_titles", idempotencyKeyHash)
        result <- existing match
          case Some(value) => acceptedForExisting(value)
          case None => create(requestedBy, idempotencyKeyHash, operationId, campaignId)
      yield result
    case _ => AppError.Internal("Failed to allocate analysis campaign identifiers.").asLeft
        .pure[ConnectionIO]

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

  private def create(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      campaignId: String,
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    for
      targets <- sql"""
        SELECT s.game_title_id, s.input_revision, s.algorithm_version,
               s.artifact_schema_version, s.validation_contract_id
        FROM series_analysis_title_states s
        ORDER BY s.game_title_id
        FOR UPDATE
      """.query[CampaignTargetRow].to[List]
      result <- targets match
        case Nil => AppError.AnalysisNoEligibleTitles().asLeft[SeriesAnalysisRecalculationAccepted]
            .pure[ConnectionIO]
        case values => createForTargets(
            requestedBy,
            idempotencyKeyHash,
            operationId,
            campaignId,
            values,
          )
    yield result

  private def createForTargets(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      operationId: String,
      campaignId: String,
      targets: List[CampaignTargetRow],
  ): ConnectionIO[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    for
      acceptedAt <- sql"SELECT now()".query[Instant].unique
      algorithmVersion = targets.map(_.algorithmVersion).distinct match
        case single :: Nil => single
        case _ => "mixed"
      artifactSchemaVersion = targets.map(_.artifactSchemaVersion).max
      validationContractId = targets.map(_.validationContractId).distinct match
        case single :: Nil => single
        case _ => None
      _ <- sql"""
        INSERT INTO series_analysis_operation_requests (
          id, scope, requested_by_account_id, idempotency_key_hash,
          endpoint, status, target_count, accepted_at
        ) VALUES (
          $operationId, 'all_titles', $requestedBy, $idempotencyKeyHash,
          'all_titles', 'running', ${targets.size}, $acceptedAt
        )
      """.update.run.void
      _ <- sql"""
        INSERT INTO series_analysis_campaigns (
          id, operation_request_id, trigger, algorithm_version,
          artifact_schema_version, validation_contract_id,
          status, target_count, accepted_at
        ) VALUES (
          $campaignId, $operationId, 'manual', $algorithmVersion,
          $artifactSchemaVersion, $validationContractId,
          'expanding', ${targets.size}, $acceptedAt
        )
      """.update.run.void
      snapshots = targets.map(target =>
        CampaignTargetSnapshot(
          campaignId,
          target.gameTitleId,
          target.inputRevision,
          target.algorithmVersion,
          target.artifactSchemaVersion,
          target.validationContractId,
          acceptedAt,
        )
      )
      _ <- Update[CampaignTargetSnapshot](
        """INSERT INTO series_analysis_campaign_targets (
          campaign_id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id,
          status, job_request_id, accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)"""
      ).updateMany(snapshots).void
    yield SeriesAnalysisRecalculationAccepted(
      operationId,
      acceptedAt,
      targets.size,
      Some(SeriesAnalysisAcceptedCampaign(campaignId, "expanding")),
      None,
    ).asRight

end PostgresSeriesAnalysisCampaignRequestOps
