package momo.api.domain

enum AccountRole(val wire: String) derives CanEqual:
  case User extends AccountRole("user")
  case Operator extends AccountRole("operator")
  case Admin extends AccountRole("admin")

object AccountRole:
  def fromWire(value: String): Either[String, AccountRole] = values.find(_.wire == value)
    .toRight("role must be user, operator, or admin.")
