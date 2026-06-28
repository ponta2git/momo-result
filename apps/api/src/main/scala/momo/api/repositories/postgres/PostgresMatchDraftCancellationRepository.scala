package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.db.Database
import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.*
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{MatchDraftCancellationRepository, MatchDraftCancellationResult}

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
