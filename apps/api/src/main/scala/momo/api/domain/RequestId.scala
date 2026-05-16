package momo.api.domain

object RequestId:
  val Description: String = "requestId must match ^[A-Za-z0-9_-]{1,64}$."

  private val ValidPattern = "^[A-Za-z0-9_-]{1,64}$".r

  def sanitize(raw: String): Option[String] =
    val trimmed = raw.trim
    Option.when(ValidPattern.matches(trimmed))(trimmed)
end RequestId
