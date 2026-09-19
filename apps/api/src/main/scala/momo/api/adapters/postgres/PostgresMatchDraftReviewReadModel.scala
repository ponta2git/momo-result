package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{ImageId, MatchDraftId}
import momo.api.domain.{MatchDraftReview, ScreenType}
import momo.api.repositories.MatchDraftReviewReadModel

final class PostgresMatchDraftReviewReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftReviewReadModel[F], PostgresMatchDraftsRowSupport:
  override def find(draftId: MatchDraftId): F[Option[MatchDraftReview]] =
    // One statement gives all three slots the same MVCC snapshot, including OCR completion
    // and source-image retention. No object-store request is needed for these descriptors.
    (fr"""SELECT draft.*, o.id, o.job_id, o.requested_screen_type, o.detected_screen_type,
                 o.profile_id, o.payload_json, o.warnings_json, o.timings_ms_json,
                 o.created_at, o.updated_at, slot.kind, image.id, image.media_type
          FROM (""" ++ selectAll ++ fr""" WHERE id = $draftId) draft
          CROSS JOIN LATERAL (VALUES
            ('total_assets', draft.total_assets_draft_id, draft.total_assets_image_id),
            ('revenue', draft.revenue_draft_id, draft.revenue_image_id),
            ('incident_log', draft.incident_log_draft_id, draft.incident_log_image_id)
          ) AS slot(kind, ocr_draft_id, source_image_id)
          LEFT JOIN ocr_drafts o ON o.id = slot.ocr_draft_id
          LEFT JOIN source_images image ON image.id = slot.source_image_id
            AND image.status = 'AVAILABLE' AND draft.source_images_deleted_at IS NULL
          ORDER BY CASE slot.kind WHEN 'total_assets' THEN 1 WHEN 'revenue' THEN 2 ELSE 3 END
       """).query[(Row, Option[PostgresOcrDrafts.Row], ScreenType, Option[(ImageId, String)])].to[List]
      .flatMap { rows =>
        rows.headOption.traverse { case (row, _, _, _) =>
          toDraft(row).map(draft => MatchDraftReview(
            draft,
            rows.flatMap(_._2).map(PostgresOcrDrafts.toDraft),
            rows.flatMap { case (_, _, kind, image) =>
              image.map { case (imageId, mediaType) => MatchDraftReview.SourceImage(kind, imageId, mediaType) }
            },
          ))
        }
      }.transact(transactor)
