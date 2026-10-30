package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.adapters.postgres.CanonicalIdentity.Entity
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
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def isForeignKeyViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.FOREIGN_KEY_VIOLATION.value

  private def appError[A](error: AppError): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(error))

  private def isUserEditable(status: MatchDraftStatus): Boolean = MatchDraftStatus
    .userEditableStatuses.contains(status)

  def alg(using ids: PostgresIdentities): MatchDraftsAlg[ConnectionIO] =
    new MatchDraftsAlg[ConnectionIO]:
      override def create(draft: MatchDraft): ConnectionIO[Unit] = (for
        newId <- ids.newId(draft.id.value)
        refs <- references(draft)
        _ <- sql"""
        INSERT INTO match_drafts (
          ${ids.idColumns}, created_by_account_id, created_by_member_id, status, held_event_id, match_no_in_event,
          game_title_id, layout_family, season_master_id, owner_member_id, map_master_id,
          played_at, total_assets_image_id, revenue_image_id, incident_log_image_id,
          total_assets_draft_id ${ids.legacyColumn("total_assets_draft_id")},
          revenue_draft_id ${ids.legacyColumn("revenue_draft_id")},
          incident_log_draft_id ${ids.legacyColumn("incident_log_draft_id")},
          source_images_retained_until, source_images_deleted_at, confirmed_match_id,
          created_at, updated_at
        ) VALUES (
          $newId, ${refs.creator}, ${refs.creatorMember}, ${draft.status}, ${refs.heldEvent}, ${draft.matchNoInEvent},
          ${refs.title}, ${draft.layoutFamily}, ${refs.season}, ${refs.owner}, ${refs.map},
          ${draft.playedAt}, ${draft.totalAssetsImageId}, ${draft.revenueImageId}, ${draft.incidentLogImageId},
          ${refs.assets} ${ids.legacyValue(draft.totalAssetsDraftId.map(_.value))},
          ${refs.revenue} ${ids.legacyValue(draft.revenueDraftId.map(_.value))},
          ${refs.incidents} ${ids.legacyValue(draft.incidentLogDraftId.map(_.value))},
          ${draft.sourceImagesRetainedUntil}, ${draft.sourceImagesDeletedAt}, ${refs.confirmed},
          ${draft.createdAt}, ${draft.updatedAt}
        )
      """.update.run
      yield ()).exceptSomeSqlState {
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
          references(draft).flatMap { refs =>
            sql"""
      UPDATE match_drafts SET
        status = ${draft.status},
        held_event_id = ${refs.heldEvent},
        match_no_in_event = ${draft.matchNoInEvent},
        game_title_id = ${refs.title},
        layout_family = ${draft.layoutFamily},
        season_master_id = ${refs.season},
        owner_member_id = ${refs.owner},
        map_master_id = ${refs.map},
        played_at = ${draft.playedAt},
        total_assets_image_id = ${draft.totalAssetsImageId},
        revenue_image_id = ${draft.revenueImageId},
        incident_log_image_id = ${draft.incidentLogImageId},
        total_assets_draft_id = ${refs.assets} ${ids.legacySet(
                "total_assets_draft_id",
                fr"${draft.totalAssetsDraftId.map(_.value)}"
              )},
        revenue_draft_id = ${refs.revenue} ${ids.legacySet(
                "revenue_draft_id",
                fr"${draft.revenueDraftId.map(_.value)}"
              )},
        incident_log_draft_id = ${refs.incidents} ${ids.legacySet(
                "incident_log_draft_id",
                fr"${draft.incidentLogDraftId.map(_.value)}"
              )},
        source_images_retained_until = ${draft.sourceImagesRetainedUntil},
        source_images_deleted_at = ${draft.sourceImagesDeletedAt},
        confirmed_match_id = ${refs.confirmed},
        updated_at = $updatedAt
      WHERE id = ${ids.lookup(Entity.MatchDrafts, draft.id.value)}
        AND created_by_account_id = ${refs.creator}
        AND updated_at = ${draft.updatedAt}
        AND status IN (
          ${MatchDraftStatus.OcrFailed},
          ${MatchDraftStatus.DraftReady},
          ${MatchDraftStatus.NeedsReview}
        )
    """.update.run
          }.flatMap {
            case affected if affected > 0 =>
              val cancel = if draft.confirmedMatchId.nonEmpty then
                PostgresResultNotificationCancellation.draftsUnavailable(List(draft.id), updatedAt)
              else ().pure[ConnectionIO]
              cancel.as(MatchDraftUpdateResult.Updated)
            case _ => MatchDraftUpdateResult.NotEditableOrChanged.pure[ConnectionIO]
          }

      override def find(id: MatchDraftId): ConnectionIO[Option[MatchDraft]] =
        (selectAll ++ fr"WHERE id = ${ids.lookup(Entity.MatchDrafts, id.value)}").query[
          Row
        ].option.flatMap(_.traverse(toDraft))

      override def markOcrFailed(
          draftId: MatchDraftId,
          updatedAt: Instant,
      ): ConnectionIO[MatchDraftOcrFailureResult] =
        sql"""
      UPDATE match_drafts SET
        status = ${MatchDraftStatus.OcrFailed},
        updated_at = $updatedAt
      WHERE id = ${ids.lookup(Entity.MatchDrafts, draftId.value)}
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
        SELECT ${ids.wireId("match_drafts")} FROM match_drafts WHERE id = ${ids.lookup(
            Entity.MatchDrafts,
            draftId.value
          )} FOR UPDATE
      """.query[MatchDraftId].option
        val lockSource = sql"""
        SELECT ${ids.wireId("source_images")} FROM source_images
        WHERE id = ${ids.lookup(
            Entity.SourceImages,
            sourceImageId.value
          )} AND status = ${SourceImageStatus.Available}
        FOR UPDATE
      """.query[ImageId].option
        val prefix = screenType match
          case ScreenType.TotalAssets => Some("total_assets")
          case ScreenType.Revenue => Some("revenue")
          case ScreenType.IncidentLog => Some("incident_log")
          case ScreenType.Auto => None
        val attach = prefix.fold(0.pure[ConnectionIO]) { prefix =>
          val imageColumn = Fragment.const(s"${prefix}_image_id")
          val draftColumn = Fragment.const(s"${prefix}_draft_id")
          ids.retainedValue(Entity.OcrDrafts, ocrDraftId.value).flatMap { nativeDraft =>
            sql"""
              UPDATE match_drafts SET
                $imageColumn = $sourceImageId,
                $draftColumn = $nativeDraft ${ids.legacySet(
                s"${prefix}_draft_id",
                fr"${ocrDraftId.value}"
              )},
                status = ${MatchDraftStatus.OcrRunning}, source_images_deleted_at = NULL,
                updated_at = $updatedAt
              WHERE id = ${ids.lookup(Entity.MatchDrafts, draftId.value)}
                AND status <> ${MatchDraftStatus.Confirmed}
                AND status <> ${MatchDraftStatus.Cancelled}
                AND ($draftColumn IS NULL OR NOT EXISTS (
                  SELECT 1 FROM ocr_jobs existing
                  WHERE existing.draft_id = ${Fragment.const(s"match_drafts.${prefix}_draft_id")}
                    AND existing.status IN ('queued', 'running')
                ))
            """.update.run
          }
        }

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

  private final case class References(
      creator: Fragment,
      creatorMember: Fragment,
      heldEvent: Fragment,
      title: Fragment,
      season: Fragment,
      owner: Fragment,
      map: Fragment,
      confirmed: Fragment,
      assets: Fragment,
      revenue: Fragment,
      incidents: Fragment,
  )

  private def references(draft: MatchDraft)(using
      ids: PostgresIdentities): ConnectionIO[References] =
    for
      creator <- ids.requireReference(Entity.Accounts, draft.createdByAccountId.value)
      creatorMember <- ids.requireReference(Entity.Members, draft.createdByMemberId.map(_.value))
      heldEvent <- ids.requireReference(Entity.HeldEvents, draft.heldEventId.map(_.value))
      title <- ids.requireReference(Entity.GameTitles, draft.gameTitleId.map(_.value))
      season <- ids.requireReference(Entity.SeasonMasters, draft.seasonMasterId.map(_.value))
      owner <- ids.requireReference(Entity.Members, draft.ownerMemberId.map(_.value))
      map <- ids.requireReference(Entity.MapMasters, draft.mapMasterId.map(_.value))
      confirmed <- ids.requireReference(Entity.Matches, draft.confirmedMatchId.map(_.value))
      assets <- ids.retainedValue(Entity.OcrDrafts, draft.totalAssetsDraftId.map(_.value))
      revenue <- ids.retainedValue(Entity.OcrDrafts, draft.revenueDraftId.map(_.value))
      incidents <- ids.retainedValue(Entity.OcrDrafts, draft.incidentLogDraftId.map(_.value))
    yield References(
      creator,
      creatorMember,
      heldEvent,
      title,
      season,
      owner,
      map,
      confirmed,
      assets,
      revenue,
      incidents
    )

end PostgresMatchDrafts
