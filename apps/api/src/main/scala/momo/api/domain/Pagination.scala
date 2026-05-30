package momo.api.domain

final case class PageRequest(page: Int, pageSize: Int):
  val offset: Long = (page.toLong - 1L) * pageSize.toLong

final case class PagedResult[A](items: List[A], page: PageRequest, totalItems: Int):
  val totalPages: Int =
    if totalItems <= 0 then 0
    else ((totalItems.toLong + page.pageSize.toLong - 1L) / page.pageSize.toLong).toInt

  val hasPreviousPage: Boolean = page.page > 1 && totalPages > 0
  val hasNextPage: Boolean = totalPages > 0 && page.page < totalPages
