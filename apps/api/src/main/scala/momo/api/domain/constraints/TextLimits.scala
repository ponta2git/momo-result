package momo.api.domain.constraints

object TextLimits:
  // Bound names before they are repeated across list, detail and export projections.
  val NameMaxCodePoints: Int = 256
