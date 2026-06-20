package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate
import doobie.util.fragments

import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent, ScreenType}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  MatchDraftCancellationRepository, MatchDraftCancellationResult, MatchDraftsAlg,
  MatchDraftsRepository,
}

/**
 * Pure [[MatchDraftsAlg]] in `ConnectionIO` and a `Transactor[F]`-lifted facade. Mirrors the same
 * structure used by `PostgresMatches` / `PostgresHeldEvents` so all Postgres repositories share a
 * single style.
 */
object PostgresMatchDrafts:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def isForeignKeyViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.FOREIGN_KEY_VIOLATION.value

  private def appError[A](error: AppError): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(error))

  private def isUserEditable(status: MatchDraftStatus): Boolean = MatchDraftStatus
    .userEditableStatuses.contains(status)

  private final case class Row(
      id: MatchDraftId,
      createdByAccountId: AccountId,
      createdByMemberId: Option[MemberId],
      status: MatchDraftStatus,
      heldEventId: Option[HeldEventId],
      matchNoInEvent: Option[MatchNoInEvent],
      gameTitleId: Option[GameTitleId],
      layoutFamily: Option[String],
      seasonMasterId: Option[SeasonMasterId],
      ownerMemberId: Option[MemberId],
      mapMasterId: Option[MapMasterId],
      playedAt: Option[Instant],
      totalAssetsImageId: Option[ImageId],
      revenueImageId: Option[ImageId],
      incidentLogImageId: Option[ImageId],
      totalAssetsDraftId: Option[OcrDraftId],
      revenueDraftId: Option[OcrDraftId],
      incidentLogDraftId: Option[OcrDraftId],
      sourceImagesRetainedUntil: Option[Instant],
      sourceImagesDeletedAt: Option[Instant],
      confirmedMatchId: Option[MatchId],
      createdAt: Instant,
      updatedAt: Instant,
  )

  private val selectAll = fr"""SELECT
      id, created_by_account_id, created_by_member_id, status, held_event_id, match_no_in_event,
      game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
      played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
      total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
      source_images_retained_until, source_images_deleted_at, confirmed_match_id,
      created_at, updated_at
    FROM match_drafts"""

  private def toDraft(row: Row): ConnectionIO[MatchDraft] = MatchDraft.fromInputs(
    id = row.id,
    createdByAccountId = row.createdByAccountId,
    createdByMemberId = row.createdByMemberId,
    status = row.status,
    heldEventId = row.heldEventId,
    matchNoInEvent = row.matchNoInEvent,
    gameTitleId = row.gameTitleId,
    layoutFamily = row.layoutFamily,
    seasonMasterId = row.seasonMasterId,
    ownerMemberId = row.ownerMemberId,
    mapMasterId = row.mapMasterId,
    playedAt = row.playedAt,
    totalAssetsImageId = row.totalAssetsImageId,
    revenueImageId = row.revenueImageId,
    incidentLogImageId = row.incidentLogImageId,
    totalAssetsDraftId = row.totalAssetsDraftId,
    revenueDraftId = row.revenueDraftId,
    incidentLogDraftId = row.incidentLogDraftId,
    sourceImagesRetainedUntil = row.sourceImagesRetainedUntil,
    sourceImagesDeletedAt = row.sourceImagesDeletedAt,
    confirmedMatchId = row.confirmedMatchId,
    createdAt = row.createdAt,
    updatedAt = row.updatedAt,
  ).fold(
    err =>
      MonadThrow[ConnectionIO]
        .raiseError(IllegalStateException(s"inconsistent match_drafts row: ${err.message}")),
    MonadThrow[ConnectionIO].pure,
  )

  val alg: MatchDraftsAlg[ConnectionIO] = new MatchDraftsAlg[ConnectionIO]:
    override def create(draft: MatchDraft): ConnectionIO[Unit] = sql"""
      INSERT INTO match_drafts (
        id, created_by_account_id, created_by_member_id, status, held_event_id, match_no_in_event,
        game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
        played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
        total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
        source_images_retained_until, source_images_deleted_at, confirmed_match_id,
        created_at, updated_at
      ) VALUES (
        ${draft.id}, ${draft.createdByAccountId}, ${draft.createdByMemberId}, ${draft
        .status}, ${draft.heldEventId}, ${draft.matchNoInEvent},
        ${draft.gameTitleId}, ${draft.layoutFamily}, ${draft.seasonMasterId}, ${draft
        .ownerMemberId}, ${draft.mapMasterId},
        ${draft.playedAt}, ${draft.totalAssetsImageId}, ${draft.revenueImageId}, ${draft
        .incidentLogImageId},
        ${draft.totalAssetsDraftId}, ${draft.revenueDraftId}, ${draft.incidentLogDraftId},
        ${draft.sourceImagesRetainedUntil}, ${draft.sourceImagesDeletedAt}, ${draft
        .confirmedMatchId},
        ${draft.createdAt}, ${draft.updatedAt}
      )
    """.update.run.void.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        appError(AppError.Conflict(s"match draft already exists: ${draft.id.value}"))
      case state if isForeignKeyViolation(state) =>
        appError(AppError.Conflict("match draft prerequisites changed before creation."))
    }

    override def update(draft: MatchDraft, updatedAt: Instant): ConnectionIO[Boolean] =
      if !isUserEditable(draft.status) then false.pure[ConnectionIO]
      else
        sql"""
      UPDATE match_drafts SET
        status = ${draft.status},
        held_event_id = ${draft.heldEventId},
        match_no_in_event = ${draft.matchNoInEvent},
        game_title_id = ${draft.gameTitleId},
        layout_family = ${draft.layoutFamily},
        season_master_id = ${draft.seasonMasterId},
        owner_member_id = ${draft.ownerMemberId},
        map_master_id = ${draft.mapMasterId},
        played_at = ${draft.playedAt},
        total_assets_image_id = ${draft.totalAssetsImageId},
        revenue_image_id = ${draft.revenueImageId},
        incident_log_image_id = ${draft.incidentLogImageId},
        total_assets_draft_id = ${draft.totalAssetsDraftId},
        revenue_draft_id = ${draft.revenueDraftId},
        incident_log_draft_id = ${draft.incidentLogDraftId},
        source_images_retained_until = ${draft.sourceImagesRetainedUntil},
        source_images_deleted_at = ${draft.sourceImagesDeletedAt},
        confirmed_match_id = ${draft.confirmedMatchId},
        updated_at = $updatedAt
      WHERE id = ${draft.id}
        AND updated_at = ${draft.updatedAt}
        AND status IN (
          ${MatchDraftStatus.OcrFailed},
          ${MatchDraftStatus.DraftReady},
          ${MatchDraftStatus.NeedsReview}
        )
    """.update.run.map(_ > 0)

    override def find(id: MatchDraftId): ConnectionIO[Option[MatchDraft]] =
      (selectAll ++ fr"WHERE id = $id").query[Row].option.flatMap(_.traverse(toDraft))

    override def list(filter: MatchDraftsRepository.ListFilter): ConnectionIO[List[MatchDraft]] =
      val conditions = List(
        filter.heldEventId.map(v => fr"held_event_id = $v"),
        filter.gameTitleId.map(v => fr"game_title_id = $v"),
        filter.seasonMasterId.map(v => fr"season_master_id = $v"),
        Option
          .when(filter.statuses.nonEmpty)(fr"status = ANY(${filter.statuses.map(_.wire).toArray})"),
      ).flatten
      val where = fragments.whereAndOpt(conditions)
      val limit = filter.limit.map(v => fr"LIMIT $v").getOrElse(Fragment.empty)
      (selectAll ++ where ++ fr"ORDER BY updated_at DESC, created_at DESC" ++ limit).query[Row]
        .to[List].flatMap(_.traverse(toDraft))

    override def markConfirmed(
        draftId: MatchDraftId,
        confirmedMatchId: MatchId,
        updatedAt: Instant,
    ): ConnectionIO[Boolean] = sql"""
      UPDATE match_drafts SET
        status = ${MatchDraftStatus.Confirmed},
        confirmed_match_id = $confirmedMatchId,
        updated_at = $updatedAt
      WHERE id = $draftId
        AND status <> ${MatchDraftStatus.Confirmed}
        AND status <> ${MatchDraftStatus.Cancelled}
    """.update.run.map(_ > 0)

    override def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): ConnectionIO[Boolean] =
      sql"""
      UPDATE match_drafts SET
        status = ${MatchDraftStatus.OcrFailed},
        updated_at = $updatedAt
      WHERE id = $draftId
        AND status = ${MatchDraftStatus.OcrRunning}
    """.update.run.map(_ > 0)

    override def cancel(draftId: MatchDraftId, updatedAt: Instant): ConnectionIO[Boolean] = sql"""
      DELETE FROM match_drafts
      WHERE id = $draftId
        AND status IN (
          ${MatchDraftStatus.OcrRunning},
          ${MatchDraftStatus.OcrFailed},
          ${MatchDraftStatus.DraftReady},
          ${MatchDraftStatus.NeedsReview}
        )
    """.update.run.map(_ > 0)

    override def attachOcrArtifacts(
        draftId: MatchDraftId,
        screenType: ScreenType,
        sourceImageId: ImageId,
        ocrDraftId: OcrDraftId,
        updatedAt: Instant,
    ): ConnectionIO[Boolean] = screenType match
      case ScreenType.TotalAssets => sql"""
          UPDATE match_drafts SET
            total_assets_image_id = $sourceImageId,
            total_assets_draft_id = $ocrDraftId,
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
            AND status <> ${MatchDraftStatus.Confirmed}
            AND status <> ${MatchDraftStatus.Cancelled}
            AND (
              total_assets_draft_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM ocr_jobs existing
                WHERE existing.draft_id = match_drafts.total_assets_draft_id
                  AND existing.status IN ('queued', 'running')
              )
            )
        """.update.run.map(_ > 0)
      case ScreenType.Revenue => sql"""
          UPDATE match_drafts SET
            revenue_image_id = $sourceImageId,
            revenue_draft_id = $ocrDraftId,
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
            AND status <> ${MatchDraftStatus.Confirmed}
            AND status <> ${MatchDraftStatus.Cancelled}
            AND (
              revenue_draft_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM ocr_jobs existing
                WHERE existing.draft_id = match_drafts.revenue_draft_id
                  AND existing.status IN ('queued', 'running')
              )
            )
        """.update.run.map(_ > 0)
      case ScreenType.IncidentLog => sql"""
          UPDATE match_drafts SET
            incident_log_image_id = $sourceImageId,
            incident_log_draft_id = $ocrDraftId,
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
            AND status <> ${MatchDraftStatus.Confirmed}
            AND status <> ${MatchDraftStatus.Cancelled}
            AND (
              incident_log_draft_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM ocr_jobs existing
                WHERE existing.draft_id = match_drafts.incident_log_draft_id
                  AND existing.status IN ('queued', 'running')
              )
            )
        """.update.run.map(_ > 0)
      case ScreenType.Auto => false.pure[ConnectionIO]

    override def markSourceImagesRetention(
        draftId: MatchDraftId,
        retainedUntil: Option[Instant],
        deletedAt: Option[Instant],
        updatedAt: Instant,
    ): ConnectionIO[Boolean] = sql"""
      UPDATE match_drafts SET
        source_images_retained_until = $retainedUntil,
        source_images_deleted_at = $deletedAt,
        updated_at = $updatedAt
      WHERE id = $draftId
    """.update.run.map(_ > 0)
end PostgresMatchDrafts

object PostgresMatchDraftCancellation:
  private final case class DeletedDraft(
      totalAssetsImageId: Option[ImageId],
      revenueImageId: Option[ImageId],
      incidentLogImageId: Option[ImageId],
      totalAssetsDraftId: Option[OcrDraftId],
      revenueDraftId: Option[OcrDraftId],
      incidentLogDraftId: Option[OcrDraftId],
  ):
    def sourceImageIds: List[ImageId] = List(totalAssetsImageId, revenueImageId, incidentLogImageId)
      .flatten

    def ocrDraftIds: List[OcrDraftId] = List(totalAssetsDraftId, revenueDraftId, incidentLogDraftId)
      .flatten

  def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
  ): ConnectionIO[MatchDraftCancellationResult] = deleteCancellableDraft(draftId).flatMap {
    case Some(deleted) => PostgresOcrJobs.alg.cancelQueuedByDraftIds(deleted.ocrDraftIds, updatedAt)
        .as(MatchDraftCancellationResult.Cancelled(deleted.sourceImageIds))
    case None => classifyCurrent(draftId)
  }

  private def deleteCancellableDraft(draftId: MatchDraftId): ConnectionIO[Option[DeletedDraft]] =
    sql"""
      DELETE FROM match_drafts
      WHERE id = $draftId
        AND status IN (
          ${MatchDraftStatus.OcrRunning},
          ${MatchDraftStatus.OcrFailed},
          ${MatchDraftStatus.DraftReady},
          ${MatchDraftStatus.NeedsReview}
        )
      RETURNING
        total_assets_image_id, revenue_image_id, incident_log_image_id,
        total_assets_draft_id, revenue_draft_id, incident_log_draft_id
    """.query[DeletedDraft].option

  private def classifyCurrent(draftId: MatchDraftId): ConnectionIO[MatchDraftCancellationResult] =
    PostgresMatchDrafts.alg.find(draftId).map {
      case None => MatchDraftCancellationResult.NotFound
      case Some(draft) => MatchDraftCancellationResult.NotCancellable(draft.status)
    }
end PostgresMatchDraftCancellation

/** Backwards-compatible class facade. */
final class PostgresMatchDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftsRepository[F]:
  private val delegate: MatchDraftsRepository[F] = MatchDraftsRepository
    .fromAlg(PostgresMatchDrafts.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMatchDraftsRepository

final class PostgresMatchDraftCancellationRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends MatchDraftCancellationRepository[F]:
  private val transactK = Database.transactK(transactor)

  override def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
  ): F[MatchDraftCancellationResult] =
    transactK(PostgresMatchDraftCancellation.cancelDraftAndQueuedOcrJobs(draftId, updatedAt))
end PostgresMatchDraftCancellationRepository
