package momo.api.usecases

import momo.api.domain.MatchRecord
import momo.api.repositories.MatchesRepository

final class ListMatches[F[_]](matches: MatchesRepository[F]):
  def run(filter: MatchesRepository.ListFilter): F[List[MatchRecord]] = matches.list(filter)
