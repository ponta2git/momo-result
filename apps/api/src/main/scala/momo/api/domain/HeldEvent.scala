package momo.api.domain

import java.time.Instant

final case class HeldEvent(
    id: String,
    name: String,
    heldAt: Instant,
    matchCount: Int
)
