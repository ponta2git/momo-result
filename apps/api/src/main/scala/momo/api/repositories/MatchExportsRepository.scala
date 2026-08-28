package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.FourPlayers
import momo.api.domain.ids.*

trait MatchExportsAlg[F0[_]]:
  /**
   * Returns at most `selection.limit` recent matches, ordered by the stable export order. Sequence
   * values are evaluated against all matches in the corresponding season and game title before
   * the selection is applied.
   */
  def project(
      selection: MatchExportsRepository.Selection
  ): F0[List[MatchExportsRepository.ProjectedMatch]]

trait MatchExportsRepository[F[_]] extends MatchExportsAlg[F]

object MatchExportsRepository:
  final case class Selection(
      heldEventId: Option[HeldEventId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      matchId: Option[MatchId] = None,
      limit: Int,
  )

  /**
   * Export-only read model. It deliberately excludes creation metadata and OCR draft references;
   * adapters materialize player and incident children only for these selected parents.
   */
  final case class ProjectedMatch(
      id: MatchId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      seasonSequence: Int,
      gameTitleSequence: Int,
      players: FourPlayers,
  )

  def fromAlg[F0[_], F[_]](
      alg: MatchExportsAlg[F0],
      liftK: F0 ~> F,
  ): MatchExportsRepository[F] = new MatchExportsRepository[F]:
    override def project(selection: Selection): F[List[ProjectedMatch]] =
      liftK(alg.project(selection))

end MatchExportsRepository
