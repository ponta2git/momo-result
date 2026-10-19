package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{ImageId, MatchDraftId, OcrDraftId}
import momo.api.domain.{MatchDraftReview, ScreenType}
import momo.api.repositories.MatchDraftReviewReadModel

final class PostgresMatchDraftReviewReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftReviewReadModel[F], PostgresMatchDraftsRowSupport:
  override def find(draftId: MatchDraftId): F[Option[MatchDraftReview]] =
    // Metadata and bounded OCR text share one read-only snapshot, including concurrent OCR
    // completion and image retention. Large saved results cannot bypass the bulk read budget.
    (for
      _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
      rows <- (fr"""SELECT draft.*, slot.ocr_draft_id, slot.kind, image.id, image.media_type
          FROM (""" ++ selectAll ++ fr""" WHERE id = $draftId) draft
          CROSS JOIN LATERAL (VALUES
            ('total_assets', draft.total_assets_draft_id, draft.total_assets_image_id),
            ('revenue', draft.revenue_draft_id, draft.revenue_image_id),
            ('incident_log', draft.incident_log_draft_id, draft.incident_log_image_id)
          ) AS slot(kind, ocr_draft_id, source_image_id)
          LEFT JOIN source_images image ON image.id = slot.source_image_id
            AND image.status = 'AVAILABLE' AND draft.source_images_deleted_at IS NULL
          ORDER BY CASE slot.kind WHEN 'total_assets' THEN 1 WHEN 'revenue' THEN 2 ELSE 3 END
       """).query[(
          Row,
          Option[OcrDraftId],
          ScreenType,
          Option[(ImageId, String)]
      )].to[List]
      review <- rows.headOption.traverse { case (row, _, _, _) =>
        for
          draft <- toDraft(row)
          ocrDrafts <- PostgresOcrDrafts.alg.findMany(rows.flatMap(_._2))
        yield MatchDraftReview(
          draft,
          rows.flatMap(_._2).flatMap(ocrDrafts.get),
          rows.flatMap { case (_, _, kind, image) =>
            image.map { case (imageId, mediaType) =>
              MatchDraftReview.SourceImage(kind, imageId, mediaType)
            }
          },
        )
      }
    yield review).transact(transactor)
