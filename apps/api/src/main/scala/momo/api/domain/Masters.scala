package momo.api.domain

import java.time.Instant

/**
 * Master tables shared with the summit app via momo-db.
 *
 * `display_order` is owned by these tables and represents UI listing order. `id` is a stable text
 * identifier (not auto-generated) that is referenced by `matches.game_title_id`,
 * `matches.map_master_id`, etc.
 */
final case class GameTitle(
    id: String,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    createdAt: Instant,
)

final case class MapMaster(
    id: String,
    gameTitleId: String,
    name: String,
    displayOrder: Int,
    createdAt: Instant,
)

final case class SeasonMaster(
    id: String,
    gameTitleId: String,
    name: String,
    displayOrder: Int,
    createdAt: Instant,
)

/**
 * MVP では 6 項目固定（`requirements/base.md` §8.3）。 `key` は英語 snake_case（destination, plus_station,
 * ...）で、 ドメイン層の `IncidentCounts` の各フィールドと 1:1 対応する。
 */
final case class IncidentMaster(
    id: String,
    key: String,
    displayName: String,
    displayOrder: Int,
    createdAt: Instant,
)

final case class MemberAlias(memberId: String, alias: String, createdAt: Instant)

/**
 * Represents a row from the shared `members` table. The fixed 4 members are seeded by momo-db
 * migration `0009_seed_members`.
 */
final case class Member(id: String, userId: String, displayName: String, createdAt: Instant)
