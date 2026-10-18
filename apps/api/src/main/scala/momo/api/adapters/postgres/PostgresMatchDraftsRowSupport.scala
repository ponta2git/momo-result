package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
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

  protected def selectAll(using ids: PostgresIdentities) = fr"""SELECT
      ${ids.wireId("match_drafts")} AS id,
      ${ids.wireReference(
      Entity.Accounts,
      fr"match_drafts.created_by_account_id"
    )} AS created_by_account_id,
      ${ids.wireReference(
      Entity.Members,
      fr"match_drafts.created_by_member_id"
    )} AS created_by_member_id,
      status, ${ids.wireReference(
      Entity.HeldEvents,
      fr"match_drafts.held_event_id"
    )} AS held_event_id, match_no_in_event,
      ${ids.wireReference(
      Entity.GameTitles,
      fr"match_drafts.game_title_id"
    )} AS game_title_id, layout_family,
      ${ids.wireReference(
      Entity.SeasonMasters,
      fr"match_drafts.season_master_id"
    )} AS season_master_id,
      ${ids.wireReference(Entity.Members, fr"match_drafts.owner_member_id")} AS owner_member_id,
      ${ids.wireReference(Entity.MapMasters, fr"match_drafts.map_master_id")} AS map_master_id,
      played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
      ${ids.retainedColumn("match_drafts", "total_assets_draft_id")} AS total_assets_draft_id,
      ${ids.retainedColumn("match_drafts", "revenue_draft_id")} AS revenue_draft_id,
      ${ids.retainedColumn("match_drafts", "incident_log_draft_id")} AS incident_log_draft_id,
      source_images_retained_until, source_images_deleted_at,
      ${ids.wireReference(
      Entity.Matches,
      fr"match_drafts.confirmed_match_id"
    )} AS confirmed_match_id,
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
