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
import momo.api.errors.{AppError, AppException}

/** Inserts the match, players and incidents within the caller's confirmation transaction. */
object PostgresMatchInsertOps:

  private final case class HeaderReferences[Required, Optional](
      heldEvent: Required,
      heldEventLegacy: Option[String],
      gameTitle: Required,
      season: Required,
      owner: Required,
      mapId: Required,
      assetsDraft: Option[String],
      revenueDraft: Option[String],
      incidentsDraft: Option[String],
      creator: Required,
      creatorMember: Optional,
      noteAuthor: Optional,
  )

  def insertMatchCascade(record: MatchRecord, updatedAt: Instant)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    val input = HeaderReferences(
      record.heldEventId.value,
      Some(record.heldEventId.value),
      record.gameTitleId.value,
      record.seasonMasterId.value,
      record.ownerMemberId.value,
      record.mapMasterId.value,
      record.totalAssetsDraftId.map(_.value),
      record.revenueDraftId.map(_.value),
      record.incidentLogDraftId.map(_.value),
      record.createdByAccountId.value,
      record.createdByMemberId.map(_.value),
      record.note.updatedByAccountId.map(_.value),
    )
    for
      newId <- ids.newId(record.id.value)
      _ <- ids match
        case PostgresIdentities.Legacy => insertHeader(record, updatedAt, newId, input)
        case PostgresIdentities.Canonical =>
          resolveHeader(input).flatMap(insertHeader(record, updatedAt, newId, _))
      _ <- insertMatchChildren(record)
    yield ()

  private def resolveHeader(
      input: HeaderReferences[String, Option[String]]
  ): ConnectionIO[HeaderReferences[UUID, Option[UUID]]] =
    val ids = PostgresIdentities.Canonical
    def ocrDraft(raw: Option[String]): Fragment = raw match
      case None => fr"NULL::text"
      case Some(value) => ids.normalizedValue(Entity.OcrDrafts, value)

    def required(entity: Entity, raw: String, id: Option[UUID]): Either[AppException, UUID] =
      id.toRight(new AppException(AppError.NotFound(entity.table, raw)))
    def optional(entity: Entity, raw: Option[String], id: Option[UUID]) =
      raw.traverse(required(entity, _, id))

    sql"""
      SELECT held.id, held.legacy_id,
             ${ids.lookup(Entity.GameTitles, input.gameTitle)},
             ${ids.lookup(Entity.SeasonMasters, input.season)},
             ${ids.lookup(Entity.Members, input.owner)},
             ${ids.lookup(Entity.MapMasters, input.mapId)},
             ${ocrDraft(input.assetsDraft)}, ${ocrDraft(input.revenueDraft)}, ${ocrDraft(
        input.incidentsDraft
      )},
             ${ids.lookup(Entity.Accounts, input.creator)},
             ${ids.lookup(Entity.Members, input.creatorMember)},
             ${ids.lookup(Entity.Accounts, input.noteAuthor)}
      FROM (SELECT ${ids.lookup(Entity.HeldEvents, input.heldEvent)} AS id) requested
      LEFT JOIN held_events held ON held.id = requested.id
    """.query[HeaderReferences[Option[UUID], Option[UUID]]].unique.flatMap { row =>
      // Report the first missing supplied reference in the same order as individual lookups.
      (for
        heldEvent <- required(Entity.HeldEvents, input.heldEvent, row.heldEvent)
        title <- required(Entity.GameTitles, input.gameTitle, row.gameTitle)
        season <- required(Entity.SeasonMasters, input.season, row.season)
        owner <- required(Entity.Members, input.owner, row.owner)
        mapId <- required(Entity.MapMasters, input.mapId, row.mapId)
        creator <- required(Entity.Accounts, input.creator, row.creator)
        member <- optional(Entity.Members, input.creatorMember, row.creatorMember)
        author <- optional(Entity.Accounts, input.noteAuthor, row.noteAuthor)
      yield row.copy(
        heldEvent = heldEvent,
        gameTitle = title,
        season = season,
        owner = owner,
        mapId = mapId,
        creator = creator,
        creatorMember = member,
        noteAuthor = author,
      )).liftTo[ConnectionIO]
    }

  private def insertHeader[Id: Put](
      record: MatchRecord,
      updatedAt: Instant,
      newId: Fragment,
      refs: HeaderReferences[Id, Option[Id]]
  )(using ids: PostgresIdentities): ConnectionIO[Unit] =
    sql"""
      INSERT INTO matches (
        ${ids.idColumns}, held_event_id ${ids.legacyColumn("held_event_id")}, match_no_in_event,
        game_title_id, layout_family, season_master_id,
        owner_member_id, map_master_id, played_at,
        total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
        created_by_account_id, created_by_member_id, created_at, updated_at,
        note_body, note_version, note_updated_by_account_id, note_updated_at
      ) VALUES (
        $newId, ${refs.heldEvent} ${ids.legacyValue(
        refs.heldEventLegacy
      )}, ${record.matchNoInEvent},
        ${refs.gameTitle}, ${record.layoutFamily}, ${refs.season},
        ${refs.owner}, ${refs.mapId}, ${record.playedAt},
        ${refs.assetsDraft}, ${refs.revenueDraft}, ${refs.incidentsDraft},
        ${refs.creator}, ${refs.creatorMember}, ${record.createdAt}, $updatedAt,
        ${record.note.body.map(_.value)}, ${record.note.version.value},
        ${refs.noteAuthor}, ${record.note.updatedAt}
      )
    """.update.run.void

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
