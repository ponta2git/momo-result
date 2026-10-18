package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.*
import momo.api.repositories.{MatchDraftCancellationRepository, MatchDraftCancellationResult}

object PostgresMatchDraftCancellation:
  private final case class DeletedDraft(
      id: MatchDraftId,
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
      actorAccountId: AccountId,
  )(using ids: PostgresIdentities): ConnectionIO[MatchDraftCancellationResult] =
    deleteCancellableDraft(draftId, actorAccountId).flatMap {
      case Some(deleted) =>
        PostgresOcrSubmissions.abortForDrafts(List(deleted.id), updatedAt) *>
          PostgresOcrJobs.alg.cancelQueuedByDraftIds(deleted.ocrDraftIds, updatedAt) *>
          PostgresSourceImageLifecycle.stageDeletion(deleted.sourceImageIds, updatedAt) *>
          PostgresResultNotificationCancellation.draftsUnavailable(List(deleted.id), updatedAt)
            .as(MatchDraftCancellationResult.Cancelled)
      case None => classifyCurrent(draftId, actorAccountId)
    }

  private def deleteCancellableDraft(
      draftId: MatchDraftId,
      actorAccountId: AccountId,
  )(using ids: PostgresIdentities): ConnectionIO[Option[DeletedDraft]] =
    sql"""
      DELETE FROM match_drafts
      WHERE id = ${ids.lookup(Entity.MatchDrafts, draftId.value)}
        AND created_by_account_id = ${ids.lookup(Entity.Accounts, actorAccountId.value)}
        AND status IN (
          ${MatchDraftStatus.OcrRunning},
          ${MatchDraftStatus.OcrFailed},
          ${MatchDraftStatus.DraftReady},
          ${MatchDraftStatus.NeedsReview}
        )
      RETURNING ${ids.wireId("match_drafts")},
        total_assets_image_id, revenue_image_id, incident_log_image_id,
        ${ids.retainedColumn("match_drafts", "total_assets_draft_id")},
        ${ids.retainedColumn("match_drafts", "revenue_draft_id")},
        ${ids.retainedColumn("match_drafts", "incident_log_draft_id")}
    """.query[DeletedDraft].option

  private def classifyCurrent(
      draftId: MatchDraftId,
      actorAccountId: AccountId,
  )(using ids: PostgresIdentities): ConnectionIO[MatchDraftCancellationResult] =
    PostgresMatchDrafts.alg.find(draftId).map {
      case None => MatchDraftCancellationResult.NotFound
      case Some(draft) if draft.createdByAccountId != actorAccountId =>
        MatchDraftCancellationResult.Forbidden
      case Some(draft) => MatchDraftCancellationResult.NotCancellable(draft.status)
    }
end PostgresMatchDraftCancellation

final class PostgresMatchDraftCancellationRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends MatchDraftCancellationRepository[F]:
  private given PostgresIdentities = identities
  override def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
      actorAccountId: AccountId,
  ): F[MatchDraftCancellationResult] =
    PostgresMatchDraftCancellation
      .cancelDraftAndQueuedOcrJobs(draftId, updatedAt, actorAccountId).transact(transactor)
end PostgresMatchDraftCancellationRepository
