package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{MatchDraftsAlg, MatchDraftsRepository}

/**
 * Pure [[MatchDraftsAlg]] in `ConnectionIO` and a `Transactor[F]`-lifted facade. Mirrors the same
 * structure used by `PostgresMatches` / `PostgresHeldEvents` so all Postgres repositories share a
 * single style.
 */
object PostgresMatchDrafts:

  private type Row = (
      MatchDraftId,
      MemberId,
      MatchDraftStatus,
      Option[HeldEventId],
      Option[Int],
      Option[GameTitleId],
      Option[String],
      Option[SeasonMasterId],
      Option[MemberId],
      Option[MapMasterId],
      Option[Instant],
      Option[ImageId],
      Option[ImageId],
      Option[ImageId],
      Option[OcrDraftId],
      Option[OcrDraftId],
      Option[OcrDraftId],
      Option[Instant],
      Option[Instant],
      Option[MatchId],
      Instant,
      Instant,
  )

  private val selectAll = fr"""SELECT
      id, created_by_member_id, status, held_event_id, match_no_in_event,
      game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
      played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
      total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
      source_images_retained_until, source_images_deleted_at, confirmed_match_id,
      created_at, updated_at
    FROM match_drafts"""

  private def toDraft(row: Row): MatchDraft = MatchDraft(
    id = row._1,
    createdByMemberId = row._2,
    status = row._3,
    heldEventId = row._4,
    matchNoInEvent = row._5,
    gameTitleId = row._6,
    layoutFamily = row._7,
    seasonMasterId = row._8,
    ownerMemberId = row._9,
    mapMasterId = row._10,
    playedAt = row._11,
    totalAssetsImageId = row._12,
    revenueImageId = row._13,
    incidentLogImageId = row._14,
    totalAssetsDraftId = row._15,
    revenueDraftId = row._16,
    incidentLogDraftId = row._17,
    sourceImagesRetainedUntil = row._18,
    sourceImagesDeletedAt = row._19,
    confirmedMatchId = row._20,
    createdAt = row._21,
    updatedAt = row._22,
  )

  val alg: MatchDraftsAlg[ConnectionIO] = new MatchDraftsAlg[ConnectionIO]:
    override def create(draft: MatchDraft): ConnectionIO[Unit] = sql"""
      INSERT INTO match_drafts (
        id, created_by_member_id, status, held_event_id, match_no_in_event,
        game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
        played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
        total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
        source_images_retained_until, source_images_deleted_at, confirmed_match_id,
        created_at, updated_at
      ) VALUES (
        ${draft.id}, ${draft.createdByMemberId}, ${draft.status}, ${draft.heldEventId}, ${draft
        .matchNoInEvent},
        ${draft.gameTitleId}, ${draft.layoutFamily}, ${draft.seasonMasterId}, ${draft
        .ownerMemberId}, ${draft.mapMasterId},
        ${draft.playedAt}, ${draft.totalAssetsImageId}, ${draft.revenueImageId}, ${draft
        .incidentLogImageId},
        ${draft.totalAssetsDraftId}, ${draft.revenueDraftId}, ${draft.incidentLogDraftId},
        ${draft.sourceImagesRetainedUntil}, ${draft.sourceImagesDeletedAt}, ${draft
        .confirmedMatchId},
        ${draft.createdAt}, ${draft.updatedAt}
      )
    """.update.run.void

    override def update(draft: MatchDraft, updatedAt: Instant): ConnectionIO[Boolean] = sql"""
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
    """.update.run.map(_ > 0)

    override def find(id: MatchDraftId): ConnectionIO[Option[MatchDraft]] =
      (selectAll ++ fr"WHERE id = $id").query[Row].option.map(_.map(toDraft))

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
        .to[List].map(_.map(toDraft))

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
    """.update.run.map(_ > 0)

    override def markOcrFailed(draftId: MatchDraftId, updatedAt: Instant): ConnectionIO[Boolean] =
      sql"""
      UPDATE match_drafts SET
        status = ${MatchDraftStatus.OcrFailed},
        updated_at = $updatedAt
      WHERE id = $draftId
    """.update.run.map(_ > 0)

    override def cancel(draftId: MatchDraftId, updatedAt: Instant): ConnectionIO[Boolean] = sql"""
      UPDATE match_drafts SET
        status = ${MatchDraftStatus.Cancelled},
        updated_at = $updatedAt
      WHERE id = $draftId
    """.update.run.map(_ > 0)

    override def attachOcrArtifacts(
        draftId: MatchDraftId,
        screenType: ScreenType,
        sourceImageId: ImageId,
        ocrDraftId: OcrDraftId,
        updatedAt: Instant,
    ): ConnectionIO[Boolean] =
      val command = screenType match
        case ScreenType.TotalAssets => sql"""
          UPDATE match_drafts SET
            total_assets_image_id = $sourceImageId,
            total_assets_draft_id = $ocrDraftId,
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
        """
        case ScreenType.Revenue => sql"""
          UPDATE match_drafts SET
            revenue_image_id = $sourceImageId,
            revenue_draft_id = $ocrDraftId,
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
        """
        case ScreenType.IncidentLog => sql"""
          UPDATE match_drafts SET
            incident_log_image_id = $sourceImageId,
            incident_log_draft_id = $ocrDraftId,
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
        """
        case ScreenType.Auto => sql"""
          UPDATE match_drafts SET
            status = ${MatchDraftStatus.OcrRunning},
            source_images_deleted_at = NULL,
            updated_at = $updatedAt
          WHERE id = $draftId
        """
      command.update.run.map(_ > 0)

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

/** Backwards-compatible class facade. */
final class PostgresMatchDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftsRepository[F]:
  private val delegate: MatchDraftsRepository[F] = MatchDraftsRepository
    .fromConnectionIO(PostgresMatchDrafts.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMatchDraftsRepository
