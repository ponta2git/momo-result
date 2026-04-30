package momo.api.domain

import java.time.Instant

/** ad-hoc 開催履歴 (`held_events.session_id IS NULL`).
  *
  * `name` は持たない。表示ラベルは `heldAt` から UI 側で組み立てる。
  * `matchCount` は派生値であり、`MatchesRepository.countByHeldEvents` で計算する。
  */
final case class HeldEvent(
    id: String,
    heldAt: Instant
)
