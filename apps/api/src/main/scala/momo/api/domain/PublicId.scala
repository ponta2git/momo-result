package momo.api.domain

/** Positive public number, separate from the opaque storage and legacy identities. */
opaque type PublicId = Long

object PublicId:
  private val Decimal = "^[1-9][0-9]{0,18}$".r

  def fromString(value: String): Either[String, PublicId] =
    if Decimal.pattern.matcher(value).matches() then
      value.toLongOption.toRight("publicId exceeds the supported range").flatMap(fromLong)
    else Left("publicId must be a canonical positive decimal string")

  def fromLong(value: Long): Either[String, PublicId] =
    Either.cond(value > 0, value, "publicId must be positive")

  extension (value: PublicId)
    def value: Long = value
    def decimalString: String = value.toString

  given CanEqual[PublicId, PublicId] = CanEqual.derived
