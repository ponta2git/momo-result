package momo.api.repositories

import momo.api.domain.ids.MatchId
import momo.api.domain.{MatchDetail, MatchIdentity}

trait MatchDetailReadModel[F[_]]:
  /** Results, event metadata, names and note attribution share one read snapshot. */
  def find(id: MatchId): F[Option[MatchDetail]]
  def identity(id: MatchId): F[Option[MatchIdentity]]
