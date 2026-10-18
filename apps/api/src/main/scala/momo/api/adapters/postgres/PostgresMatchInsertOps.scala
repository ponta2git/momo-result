package momo.api.adapters.postgres

import java.time.Instant
import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.update.Update

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{IncidentKind, MatchRecord}

/**
 * Shared cascade INSERT into `matches` + `match_players` (4 rows) + `match_incidents` (≤24 rows)
 * used by both [[PostgresMatches]] (create/update) and [[PostgresMatchConfirmation]] (confirm).
 *
 * Resolves the fixed incident keys in the same transaction, then batches players and incidents.
 */
object PostgresMatchInsertOps:

  def insertMatchCascade(record: MatchRecord, updatedAt: Instant)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    for
      newId <- ids.newId(record.id.value)
      heldEventId <- ids.requireReference(Entity.HeldEvents, record.heldEventId.value)
      heldEventLegacy <-
        sql"SELECT ${ids.wireReference(Entity.HeldEvents, heldEventId)}".query[String].unique
      gameTitleId <- ids.requireReference(Entity.GameTitles, record.gameTitleId.value)
      seasonId <- ids.requireReference(Entity.SeasonMasters, record.seasonMasterId.value)
      ownerId <- ids.requireReference(Entity.Members, record.ownerMemberId.value)
      mapId <- ids.requireReference(Entity.MapMasters, record.mapMasterId.value)
      assetsId <- ids.normalize(Entity.OcrDrafts, record.totalAssetsDraftId.map(_.value))
      revenueId <- ids.normalize(Entity.OcrDrafts, record.revenueDraftId.map(_.value))
      incidentsId <- ids.normalize(Entity.OcrDrafts, record.incidentLogDraftId.map(_.value))
      creatorId <- ids.requireReference(Entity.Accounts, record.createdByAccountId.value)
      creatorMemberId <- ids.requireReference(Entity.Members, record.createdByMemberId.map(_.value))
      noteAccountId <-
        ids.requireReference(Entity.Accounts, record.note.updatedByAccountId.map(_.value))
      _ <- sql"""
        INSERT INTO matches (
          ${ids.idColumns}, held_event_id ${ids.legacyColumn("held_event_id")}, match_no_in_event,
          game_title_id, layout_family, season_master_id,
          owner_member_id, map_master_id, played_at,
          total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
          created_by_account_id, created_by_member_id, created_at, updated_at,
          note_body, note_version, note_updated_by_account_id, note_updated_at
        ) VALUES (
          $newId, $heldEventId ${ids.legacyValue(heldEventLegacy)}, ${record.matchNoInEvent},
          $gameTitleId, ${record.layoutFamily}, $seasonId,
          $ownerId, $mapId, ${record.playedAt},
          $assetsId, $revenueId, $incidentsId,
          $creatorId, $creatorMemberId, ${record.createdAt}, $updatedAt,
          ${record.note.body.map(_.value)}, ${record.note.version.value},
          $noteAccountId, ${record.note.updatedAt}
        )
      """.update.run
      _ <- insertMatchChildren(record)
    yield ()

  def replaceMatchChildren(record: MatchRecord)(using ids: PostgresIdentities): ConnectionIO[Unit] =
    sql"DELETE FROM match_incidents WHERE match_id = ${ids.lookup(Entity.Matches, record.id.value)}".update.run *>
      sql"DELETE FROM match_players WHERE match_id = ${ids.lookup(Entity.Matches, record.id.value)}".update.run *>
      insertMatchChildren(record)

  private def insertMatchChildren(record: MatchRecord)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    IncidentKindMapping.masterIds.flatMap(incidentIds => insertMatchChildren(record, incidentIds))

  private def insertMatchChildren(
      record: MatchRecord,
      incidentIds: Map[IncidentKind, IncidentMasterId],
  )(using ids: PostgresIdentities): ConnectionIO[Unit] = ids match
    case PostgresIdentities.Legacy => insertLegacyChildren(record, incidentIds)
    case PostgresIdentities.Canonical =>
      for
        matches <- ids.requireUuidReferences(Entity.Matches, List(record.id.value))
        members <-
          ids.requireUuidReferences(Entity.Members, record.players.toList.map(_.memberId.value))
        incidents <-
          ids.requireUuidReferences(Entity.IncidentMasters, incidentIds.values.toList.map(_.value))
        matchId = matches(record.id.value)
        playerRows = record.players.toList.map { player =>
          (
            matchId,
            members(player.memberId.value),
            player.playOrder.value,
            player.rank.value,
            player.totalAssetsManYen.value,
            player.revenueManYen.value,
            record.createdAt
          )
        }
        _ <- Update[(UUID, UUID, Int, Int, Int, Int, Instant)]("""INSERT INTO match_players
          (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)""").updateMany(playerRows)
        incidentRows = record.players.toList.flatMap { player =>
          player.incidents.entriesByKind.map { case (kind, count) =>
            (
              matchId,
              members(player.memberId.value),
              incidents(incidentIds(kind).value),
              count.value,
              record.createdAt
            )
          }
        }
        _ <- Update[(UUID, UUID, UUID, Int, Instant)]("""INSERT INTO match_incidents
          (match_id, member_id, incident_master_id, count, created_at)
          VALUES (?, ?, ?, ?, ?)""").updateMany(incidentRows)
      yield ()

  private def insertLegacyChildren(
      record: MatchRecord,
      incidentIds: Map[IncidentKind, IncidentMasterId],
  ): ConnectionIO[Unit] =
    val playerRows: List[(MatchId, MemberId, Int, Int, Int, Int, Instant)] = record.players.toList
      .map { p =>
        (
          record.id,
          p.memberId,
          p.playOrder.value,
          p.rank.value,
          p.totalAssetsManYen.value,
          p.revenueManYen.value,
          record.createdAt,
        )
      }
    val insertPlayers =
      Update[(MatchId, MemberId, Int, Int, Int, Int, Instant)]("""INSERT INTO match_players
         (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)""").updateMany(playerRows)

    val incidentRows: List[(MatchId, MemberId, IncidentMasterId, Int, Instant)] = record.players
      .toList.flatMap { p =>
        p.incidents.entriesByKind.map { case (kind, count) =>
          (record.id, p.memberId, incidentIds(kind), count.value, record.createdAt)
        }
      }
    val insertIncidents =
      Update[(MatchId, MemberId, IncidentMasterId, Int, Instant)]("""INSERT INTO match_incidents
         (match_id, member_id, incident_master_id, count, created_at)
         VALUES (?, ?, ?, ?, ?)""").updateMany(incidentRows)

    insertPlayers *> insertIncidents.void
end PostgresMatchInsertOps
