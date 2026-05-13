package momo.api.repositories.postgres

import momo.api.domain.IncidentKind
import momo.api.domain.ids.IncidentMasterId

/**
 * Maps the pure-domain [[IncidentKind]] to/from the DB seed value of `incident_masters.id`.
 *
 * The wire strings here MUST match the seed in `momo-db/drizzle/0008_foamy_nekra.sql`. Domain code
 * does not depend on these strings; only this repository-layer mapping does.
 */
private[postgres] object IncidentKindMapping:
  private val toWire: Map[IncidentKind, IncidentMasterId] = Map(
    IncidentKind.Destination -> IncidentMasterId.unsafeFromString("incident_destination"),
    IncidentKind.PlusStation -> IncidentMasterId.unsafeFromString("incident_plus_station"),
    IncidentKind.MinusStation -> IncidentMasterId.unsafeFromString("incident_minus_station"),
    IncidentKind.CardStation -> IncidentMasterId.unsafeFromString("incident_card_station"),
    IncidentKind.CardShop -> IncidentMasterId.unsafeFromString("incident_card_shop"),
    IncidentKind.SuriNoGinji -> IncidentMasterId.unsafeFromString("incident_suri_no_ginji"),
  )

  private val fromWire: Map[IncidentMasterId, IncidentKind] = toWire.map(_.swap)

  def masterId(kind: IncidentKind): IncidentMasterId = toWire(kind)

  def kindOf(id: IncidentMasterId): Option[IncidentKind] = fromWire.get(id)
