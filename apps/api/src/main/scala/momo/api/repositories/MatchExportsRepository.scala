package momo.api.repositories

import cats.~>

import momo.api.domain.MatchExportRow
import momo.api.domain.ids.*

trait MatchExportsAlg[F0[_]]:
  /**
   * Projects at most `selection.limit` recent matches in stable export order, four rows each.
   * Sequence numbers include full season/title history; names and results share one snapshot.
   */
  def project(selection: MatchExportsRepository.Selection): F0[List[MatchExportRow]]

trait MatchExportsRepository[F[_]] extends MatchExportsAlg[F]

object MatchExportsRepository:
  final case class Selection(
      heldEventId: Option[HeldEventId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      matchId: Option[MatchId] = None,
      limit: Int,
  )

  def fromAlg[F0[_], F[_]](
      alg: MatchExportsAlg[F0],
      liftK: F0 ~> F,
  ): MatchExportsRepository[F] = new MatchExportsRepository[F]:
    override def project(selection: Selection): F[List[MatchExportRow]] =
      liftK(alg.project(selection))
