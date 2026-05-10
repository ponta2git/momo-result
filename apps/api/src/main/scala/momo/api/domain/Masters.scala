package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

/**
 * Master tables shared with the summit app via momo-db.
 *
 * `display_order` is owned by these tables and represents UI listing order. `id` is a stable text
 * identifier (not auto-generated) that is referenced by `matches.game_title_id`,
 * `matches.map_master_id`, etc.
 */
final case class GameTitle(
    id: GameTitleId,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    createdAt: Instant,
)

final case class MapMaster(
    id: MapMasterId,
    gameTitleId: GameTitleId,
    name: String,
    displayOrder: Int,
    createdAt: Instant,
)

final case class SeasonMaster(
    id: SeasonMasterId,
    gameTitleId: GameTitleId,
    name: String,
    displayOrder: Int,
    createdAt: Instant,
)

/**
 * MVP では 6 項目固定（`requirements/base.md` §8.3）。 `key` は英語 snake_case（destination, plus_station,
 * ...）で、 ドメイン層の `IncidentCounts` の各フィールドと 1:1 対応する。
 */
final case class IncidentMaster(
    id: IncidentMasterId,
    key: String,
    displayName: String,
    displayOrder: Int,
    createdAt: Instant,
)

final case class MemberAlias(id: String, memberId: MemberId, alias: String, createdAt: Instant)

/**
 * Represents a row from the shared `members` table. The fixed 4 members are seeded by momo-db
 * migration `0009_seed_members`.
 */
final case class Member(id: MemberId, userId: UserId, displayName: String, createdAt: Instant)

/**
 * Login/operator account for momo-result. `playerMemberId` is nullable because some operators can
 * edit records without being one of the current four game participants.
 */
final case class LoginAccount(
    id: AccountId,
    discordUserId: UserId,
    displayName: String,
    playerMemberId: Option[MemberId],
    loginEnabled: Boolean,
    isAdmin: Boolean,
    createdAt: Instant,
    updatedAt: Instant,
)
