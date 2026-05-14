package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*

import momo.api.domain.ids.ImageId
import momo.api.repositories.ImageReferenceRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresImageReferenceRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends ImageReferenceRepository[F]:

  override def referencedImageIds: F[Set[ImageId]] = sql"""
      SELECT image_id FROM ocr_jobs
       WHERE status IN ('queued', 'running')
      UNION
      SELECT total_assets_image_id
        FROM match_drafts
       WHERE total_assets_image_id IS NOT NULL
         AND source_images_deleted_at IS NULL
         AND status NOT IN ('confirmed', 'cancelled')
      UNION
      SELECT revenue_image_id
        FROM match_drafts
       WHERE revenue_image_id IS NOT NULL
         AND source_images_deleted_at IS NULL
         AND status NOT IN ('confirmed', 'cancelled')
      UNION
      SELECT incident_log_image_id
        FROM match_drafts
       WHERE incident_log_image_id IS NOT NULL
         AND source_images_deleted_at IS NULL
         AND status NOT IN ('confirmed', 'cancelled')
    """.query[ImageId].to[Set].transact(transactor)
end PostgresImageReferenceRepository
