package momo.api.repositories

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEventDetail, HeldEventSummary}

trait HeldEventDetailReadModel[F[_]]:
  /** The event, confirmed results and active drafts belong to one consistent read snapshot. */
  def find(id: HeldEventId): F[Option[HeldEventDetail]]
  def summary(id: HeldEventId): F[Option[HeldEventSummary]]
