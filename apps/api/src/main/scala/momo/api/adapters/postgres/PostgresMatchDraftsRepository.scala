package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.*

/**
 * Pure [[MatchDraftsAlg]] in `ConnectionIO` and a `Transactor[F]`-lifted facade. Mirrors the same
 * structure used by `PostgresMatches` / `PostgresHeldEvents` so all Postgres repositories share a
 * single style.
 */
object PostgresMatchDrafts extends PostgresMatchDraftsRowSupport:
  private final case class HeldEventDraftStatsRow(
      heldEventId: HeldEventId,
      count: Int,
      maxMatchNo: Int,
  )

  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def isForeignKeyViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.FOREIGN_KEY_VIOLATION.value

  private def appError[A](error: AppError): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(error))

  private def isUserEditable(status: MatchDraftStatus): Boolean = MatchDraftStatus
    .userEditableStatuses.contains(status)

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

    override def update(
        draft: MatchDraft,
        updatedAt: Instant,
    ): ConnectionIO[MatchDraftUpdateResult] =
      if !isUserEditable(draft.status) then
        MatchDraftUpdateResult.NotEditableOrChanged.pure[ConnectionIO]
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
    """.update.run.map {
          case affected if affected > 0 => MatchDraftUpdateResult.Updated
          case _ => MatchDraftUpdateResult.NotEditableOrChanged
        }

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

    override def statsByHeldEvents(
        heldEventIds: List[HeldEventId]
    ): ConnectionIO[Map[HeldEventId, MatchDraftsRepository.HeldEventStats]] =
      if heldEventIds.isEmpty then
        Map.empty[HeldEventId, MatchDraftsRepository.HeldEventStats].pure[ConnectionIO]
      else
        val ids = heldEventIds.map(_.value).toArray
        sql"""
          SELECT held_event_id, COUNT(*)::int, COALESCE(MAX(match_no_in_event), 0)::int
          FROM match_drafts
          WHERE held_event_id = ANY($ids)
            AND status <> ${MatchDraftStatus.Cancelled}
            AND status <> ${MatchDraftStatus.Confirmed}
          GROUP BY held_event_id
        """.query[HeldEventDraftStatsRow].to[List].map { rows =>
          val seen = rows.map(row =>
            row.heldEventId -> MatchDraftsRepository.HeldEventStats(
              draftCount = row.count,
              maxMatchNo = row.maxMatchNo,
            )
          ).toMap
          heldEventIds.map(id =>
            id -> seen.getOrElse(
              id,
              MatchDraftsRepository.HeldEventStats(0, 0),
            )
          ).toMap
        }

    override def markOcrFailed(
        draftId: MatchDraftId,
        updatedAt: Instant,
    ): ConnectionIO[MatchDraftOcrFailureResult] =
      sql"""
      UPDATE match_drafts SET
        status = ${MatchDraftStatus.OcrFailed},
        updated_at = $updatedAt
      WHERE id = $draftId
        AND status = ${MatchDraftStatus.OcrRunning}
    """.update.run.map {
        case affected if affected > 0 => MatchDraftOcrFailureResult.MarkedFailed
        case _ => MatchDraftOcrFailureResult.NotRunning
      }

    override def attachOcrArtifacts(
        draftId: MatchDraftId,
        screenType: ScreenType,
        sourceImageId: ImageId,
        ocrDraftId: OcrDraftId,
        updatedAt: Instant,
    ): ConnectionIO[MatchDraftAttachmentResult] =
      val lockDraft = sql"""
        SELECT id FROM match_drafts WHERE id = $draftId FOR UPDATE
      """.query[MatchDraftId].option
      val lockSource = sql"""
        SELECT id FROM source_images
        WHERE id = $sourceImageId AND status = ${SourceImageStatus.Available}
        FOR UPDATE
      """.query[ImageId].option
      val attach = screenType match
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
          """.update.run
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
          """.update.run
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
          """.update.run
        case ScreenType.Auto => 0.pure[ConnectionIO]

      if screenType == ScreenType.Auto then
        MatchDraftAttachmentResult.NotAttachable
          .pure[ConnectionIO]
      else
        lockDraft.flatMap {
          case None => MatchDraftAttachmentResult.NotAttachable.pure[ConnectionIO]
          case Some(_) => lockSource.flatMap {
              case None => MatchDraftAttachmentResult.NotAttachable.pure[ConnectionIO]
              case Some(_) => attach.map {
                  case affected if affected > 0 => MatchDraftAttachmentResult.Attached
                  case _ => MatchDraftAttachmentResult.NotAttachable
                }
            }
        }

    override def markSourceImagesRetention(
        draftId: MatchDraftId,
        retainedUntil: Option[Instant],
        deletedAt: Option[Instant],
        updatedAt: Instant,
    ): ConnectionIO[MatchDraftSourceImageRetentionResult] = sql"""
      UPDATE match_drafts SET
        source_images_retained_until = $retainedUntil,
        source_images_deleted_at = $deletedAt,
        updated_at = $updatedAt
      WHERE id = $draftId
    """.update.run.map {
      case affected if affected > 0 => MatchDraftSourceImageRetentionResult.Updated
      case _ => MatchDraftSourceImageRetentionResult.NotFound
    }
end PostgresMatchDrafts
