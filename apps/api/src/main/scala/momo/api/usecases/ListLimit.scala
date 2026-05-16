package momo.api.usecases

import momo.api.errors.AppError

private[usecases] object ListLimit:
  final case class Policy(default: Int, maximum: Int)

  val HeldEvents: Policy = Policy(default = 20, maximum = 100)
  val Matches: Policy = Policy(default = 100, maximum = 200)

  def validate(field: String, value: Option[Int], policy: Policy): Either[AppError, Int] =
    val limit = value.getOrElse(policy.default)
    if limit < 1 then Left(AppError.ValidationFailed(s"$field must be between 1 and ${policy.maximum}."))
    else if limit > policy.maximum then
      Left(AppError.ValidationFailed(s"$field must be between 1 and ${policy.maximum}."))
    else Right(limit)
end ListLimit
