package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.update.Update

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraftStatus, MatchRecord}
import momo.api.repositories.MatchConfirmationRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresMatchConfirmationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchConfirmationRepository[F]:

  override def confirm(
      record: MatchRecord,
      draftId: Option[MatchDraftId],
      updatedAt: Instant,
  ): F[Boolean] =
    val program =
      for
        _ <- insertAll(record, updatedAt)
        updated <- draftId match
          case None => true.pure[ConnectionIO]
          case Some(id) => sql"""
            UPDATE match_drafts SET
              status = ${MatchDraftStatus.Confirmed},
              confirmed_match_id = ${record.id},
              updated_at = $updatedAt
            WHERE id = $id
              AND status IN (${MatchDraftStatus.DraftReady}, ${MatchDraftStatus
                .NeedsReview}, ${MatchDraftStatus.OcrFailed})
          """.update.run.map(_ > 0)
      yield updated
    program.transact(transactor)

  private def insertAll(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
    val insertMatch = sql"""
      INSERT INTO matches (
        id, held_event_id, match_no_in_event,
        game_title_id, layout_family, season_master_id,
        owner_member_id, map_master_id, played_at,
        total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
        created_by_member_id, created_at, updated_at
      ) VALUES (
        ${record.id}, ${record.heldEventId}, ${record.matchNoInEvent},
        ${record.gameTitleId}, ${record.layoutFamily}, ${record.seasonMasterId},
        ${record.ownerMemberId}, ${record.mapMasterId}, ${record.playedAt},
        ${record.totalAssetsDraftId}, ${record.revenueDraftId}, ${record.incidentLogDraftId},
        ${record.createdByMemberId}, ${record.createdAt}, $updatedAt
      )
    """.update.run

    val playerRows: List[(MatchId, MemberId, Int, Int, Int, Int, Instant)] = record.players.toList
      .map { p =>
        (
          record.id,
          p.memberId,
          p.playOrder,
          p.rank,
          p.totalAssetsManYen,
          p.revenueManYen,
          record.createdAt,
        )
      }
    val insertPlayers =
      Update[(MatchId, MemberId, Int, Int, Int, Int, Instant)]("""INSERT INTO match_players
         (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)""").updateMany(playerRows)

    val incidentRows: List[(MatchId, MemberId, IncidentMasterId, Int, Instant)] = record.players
      .toList.flatMap { p =>
        p.incidents.entriesByMasterId.map { case (incidentId, count) =>
          (record.id, p.memberId, incidentId, count, record.createdAt)
        }
      }
    val insertIncidents =
      Update[(MatchId, MemberId, IncidentMasterId, Int, Instant)]("""INSERT INTO match_incidents
         (match_id, member_id, incident_master_id, count, created_at)
         VALUES (?, ?, ?, ?, ?)""").updateMany(incidentRows)

    for
      _ <- insertMatch
      _ <- insertPlayers
      _ <- insertIncidents
    yield ()
