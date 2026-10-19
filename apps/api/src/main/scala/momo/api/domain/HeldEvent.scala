package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.HeldEventId

/**
 * ad-hoc 開催履歴 (`held_events.session_id IS NULL`).
 *
 * `name` は持たない。表示ラベルは `heldAt` から UI 側で組み立てる。試合数や次の試合番号は
 * 一覧・要約の read model で計算する。
 */
final case class HeldEvent(id: HeldEventId, heldAt: Instant)
