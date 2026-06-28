package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

final class InMemoryIncidentMastersRepository[F[_]] private (ref: Ref[F, List[IncidentMaster]])
    extends IncidentMastersRepository[F]:
  override def list: F[List[IncidentMaster]] = ref.get

object InMemoryIncidentMastersRepository:
  /** Seeded with the 6 fixed incidents matching momo-db `0008` migration. */
  def create[F[_]: Sync]: F[InMemoryIncidentMastersRepository[F]] =
    val now = Instant.EPOCH
    val seed = List(
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_destination"),
        "destination",
        "目的地",
        1,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_plus_station"),
        "plus_station",
        "プラス駅",
        2,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_minus_station"),
        "minus_station",
        "マイナス駅",
        3,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_card_station"),
        "card_station",
        "カード駅",
        4,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_card_shop"),
        "card_shop",
        "カード売り場",
        5,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_suri_no_ginji"),
        "suri_no_ginji",
        "スリの銀次",
        6,
        now,
      ),
    )
    Ref.of[F, List[IncidentMaster]](seed).map(new InMemoryIncidentMastersRepository(_))
