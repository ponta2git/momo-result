package momo.api.repositories

import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId

/**
 * Pure algebra for `held_events` access.
 *
 * `F0` is the algebra-level effect: `ConnectionIO` for the Postgres adapter (so multiple Alg ops
 * can be composed inside one transaction), or the user effect `F` for the in-memory adapter.
 *
 * Knows nothing about transactions — see [[HeldEventsRepository]] for the transactional facade.
 */
trait HeldEventsAlg[F0[_]]:
  def list(query: Option[String], limit: Int): F0[List[HeldEvent]]
  def find(id: HeldEventId): F0[Option[HeldEvent]]
  def create(event: HeldEvent): F0[Unit]
