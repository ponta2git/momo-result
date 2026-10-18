package momo.api.repositories

/** Fresh legacy-schema keys only; an existing exact replay is checked before this restriction. */
object LegacyIdempotencyKey:
  private val Pattern = "^[A-Za-z0-9._:-]{1,128}$".r
  val InvalidReason =
    "Idempotency-Key must be 1 to 128 characters using only A-Z, a-z, 0-9, dot, underscore, colon, or hyphen."
  def accepts(value: String): Boolean = Pattern.matches(value)
