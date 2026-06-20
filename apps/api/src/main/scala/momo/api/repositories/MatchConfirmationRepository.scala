package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.ids.{MatchDraftId, OcrDraftId}
import momo.api.domain.{MatchDraft, MatchRecord}

final case class MatchDraftConfirmation(
    draftId: MatchDraftId,
    updatedAt: Instant,
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
)

object MatchDraftConfirmation:
  def from(draft: MatchDraft): MatchDraftConfirmation = MatchDraftConfirmation(
    draftId = draft.id,
    updatedAt = draft.updatedAt,
    totalAssetsDraftId = draft.totalAssetsDraftId,
    revenueDraftId = draft.revenueDraftId,
    incidentLogDraftId = draft.incidentLogDraftId,
  )

trait MatchConfirmationAlg[F0[_]]:
  def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F0[Boolean]

trait MatchConfirmationRepository[F[_]]:
  def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[Boolean]

object MatchConfirmationRepository:
  def fromAlg[F0[_], F[_]](
      alg: MatchConfirmationAlg[F0],
      liftK: F0 ~> F,
  ): MatchConfirmationRepository[F] = new MatchConfirmationRepository[F]:
    def confirm(
        record: MatchRecord,
        draft: Option[MatchDraftConfirmation],
        updatedAt: Instant,
    ): F[Boolean] = liftK(alg.confirm(record, draft, updatedAt))

  def liftIdentity[F[_]](alg: MatchConfirmationAlg[F]): MatchConfirmationRepository[F] =
    new MatchConfirmationRepository[F]:
      export alg.*
end MatchConfirmationRepository
