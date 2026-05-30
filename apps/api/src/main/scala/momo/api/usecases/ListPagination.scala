package momo.api.usecases

import momo.api.domain.PageRequest
import momo.api.errors.AppError

private[usecases] object ListPagination:
  final case class Policy(defaultPageSize: Int, maximumPageSize: Int)

  val HeldEvents: Policy = Policy(defaultPageSize = 20, maximumPageSize = 100)
  val Matches: Policy = Policy(defaultPageSize = 100, maximumPageSize = 200)

  def validate(
      page: Option[Int],
      pageSize: Option[Int],
      limit: Option[Int],
      policy: Policy,
  ): Either[AppError, PageRequest] =
    for
      parsedPage <- validatePage(page)
      parsedPageSize <- validatePageSize(pageSize, limit, policy)
    yield PageRequest(parsedPage, parsedPageSize)

  private def validatePage(page: Option[Int]): Either[AppError, Int] =
    val value = page.getOrElse(1)
    if value < 1 then Left(AppError.ValidationFailed("page must be greater than or equal to 1."))
    else Right(value)

  private def validatePageSize(
      pageSize: Option[Int],
      limit: Option[Int],
      policy: Policy,
  ): Either[AppError, Int] =
    pageSize match
      case Some(value) => validateSize("pageSize", value, policy.maximumPageSize)
      case None => validateSize("limit", limit.getOrElse(policy.defaultPageSize), policy.maximumPageSize)

  private def validateSize(field: String, value: Int, maximum: Int): Either[AppError, Int] =
    if value < 1 then Left(AppError.ValidationFailed(s"$field must be between 1 and $maximum."))
    else if value > maximum then
      Left(AppError.ValidationFailed(s"$field must be between 1 and $maximum."))
    else Right(value)
end ListPagination
