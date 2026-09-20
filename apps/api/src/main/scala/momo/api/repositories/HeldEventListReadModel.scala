package momo.api.repositories

import momo.api.domain.{HeldEventListPage, PageRequest}

trait HeldEventListReadModel[F[_]]:
  def list(query: Option[String], page: PageRequest): F[HeldEventListPage]
