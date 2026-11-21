package momo.api.repositories

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{
  HeldEventDetail,
  HeldEventIdentity,
  HeldEventRecordContext,
  HeldEventSummary,
  PublicId
}

trait HeldEventDetailReadModel[F[_]]:
  /** The event, confirmed results and active drafts belong to one consistent read snapshot. */
  def find(id: HeldEventId): F[Option[HeldEventDetail]]
  def findByPublicId(publicId: PublicId): F[Option[HeldEventDetail]]
  def summary(id: HeldEventId): F[Option[HeldEventSummary]]
  def latest: F[Option[HeldEventIdentity]]
  def recordContext(id: HeldEventId): F[Option[HeldEventRecordContext]]
