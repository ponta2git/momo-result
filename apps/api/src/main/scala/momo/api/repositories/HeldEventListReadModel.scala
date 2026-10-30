package momo.api.repositories

import momo.api.domain.{
  HeldEventListPage,
  HeldEventListSearchCriteria,
  HeldEventListSort,
  PageRequest
}

trait HeldEventListReadModel[F[_]]:
  def list(
      search: HeldEventListSearchCriteria,
      sort: HeldEventListSort,
      page: PageRequest,
  ): F[HeldEventListPage]
