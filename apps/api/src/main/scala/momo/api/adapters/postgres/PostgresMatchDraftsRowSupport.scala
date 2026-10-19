package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import doobie.*
import doobie.implicits.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent}

private[postgres] trait PostgresMatchDraftsRowSupport:
  protected final case class Row(
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

  protected val selectAll = fr"""SELECT
      id, created_by_account_id, created_by_member_id, status, held_event_id, match_no_in_event,
      game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
      played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
      total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
      source_images_retained_until, source_images_deleted_at, confirmed_match_id,
      created_at, updated_at
    FROM match_drafts"""

  protected final def toDraft(row: Row): ConnectionIO[MatchDraft] = MatchDraft.fromInputs(
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
        .raiseError(PostgresDataIntegrityException.inconsistentRow(
          "match_drafts",
          row.id.value,
          err.message,
        )),
    MonadThrow[ConnectionIO].pure,
  )
