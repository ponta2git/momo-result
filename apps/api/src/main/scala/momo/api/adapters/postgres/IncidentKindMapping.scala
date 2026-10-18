package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.IncidentKind
import momo.api.domain.ids.IncidentMasterId

/**
 * The six semantic keys identify the fixed categories independently of their stored row IDs.
 */
private[postgres] object IncidentKindMapping:
  private val byKey: Map[String, IncidentKind] = Map(
    "destination" -> IncidentKind.Destination,
    "plus_station" -> IncidentKind.PlusStation,
    "minus_station" -> IncidentKind.MinusStation,
    "card_station" -> IncidentKind.CardStation,
    "card_shop" -> IncidentKind.CardShop,
    "suri_no_ginji" -> IncidentKind.SuriNoGinji,
  )

  def kindOf(key: String): Option[IncidentKind] = byKey.get(key)

  def masterIds: ConnectionIO[Map[IncidentKind, IncidentMasterId]] =
    sql"SELECT id, key FROM incident_masters ORDER BY key LIMIT 7"
      .query[(IncidentMasterId, String)].to[List].flatMap { rows =>
        if rows.size == byKey.size && rows.map(_._2).toSet == byKey.keySet then
          rows.map { case (id, key) => byKey(key) -> id }.toMap.pure[ConnectionIO]
        else
          PostgresDataIntegrityException.inconsistentRow(
            "incident_masters",
            "catalog",
            "the six fixed semantic keys are required",
          ).raiseError[ConnectionIO, Map[IncidentKind, IncidentMasterId]]
      }
