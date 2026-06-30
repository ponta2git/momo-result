package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMatchInsertOps.{insertMatchCascade, replaceMatchChildren}
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{MatchNoInEvent, MatchRecord}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MatchesAlg, MatchesRepository}

/**
 * Persists `matches` along with their dependent `match_players` (4 rows) and `match_incidents` (4 ×
 * 6 = 24 rows) atomically in a single connection. List/find load player rows in batch (single SQL
 * regardless of result cardinality) to avoid N+1.
 */
object PostgresMatches extends PostgresMatchesReadSupport:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  private def notFound[A](resource: String, id: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.NotFound(resource, id)))

  val alg: MatchesAlg[ConnectionIO] = new MatchesAlg[ConnectionIO]:
    override def create(record: MatchRecord): ConnectionIO[Unit] =
      insertMatchCascade(record, record.createdAt).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
              .toString} already exists for held event ${record.heldEventId.value}.")
      }

    override def update(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
      val updateMatch = sql"""
        UPDATE matches
        SET held_event_id = ${record.heldEventId},
            match_no_in_event = ${record.matchNoInEvent},
            game_title_id = ${record.gameTitleId},
            layout_family = ${record.layoutFamily},
            season_master_id = ${record.seasonMasterId},
            owner_member_id = ${record.ownerMemberId},
            map_master_id = ${record.mapMasterId},
            played_at = ${record.playedAt},
            total_assets_draft_id = ${record.totalAssetsDraftId},
            revenue_draft_id = ${record.revenueDraftId},
            incident_log_draft_id = ${record.incidentLogDraftId},
            updated_at = $updatedAt
        WHERE id = ${record.id}
      """.update.run
      updateMatch.flatMap {
        case 1 => replaceMatchChildren(record)
        case _ => notFound[Unit]("match", record.id.value)
      }.exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
              .toString} already exists for held event ${record.heldEventId.value}.")
      }

    override def delete(id: MatchId): ConnectionIO[Boolean] =
      for
        _ <- sql"DELETE FROM match_drafts WHERE confirmed_match_id = $id".update.run
        deleted <- sql"DELETE FROM matches WHERE id = $id".update.run.map(_ > 0)
      yield deleted

    override def find(id: MatchId): ConnectionIO[Option[MatchRecord]] =
      (selectMatch ++ fr"WHERE id = $id").query[MatchRow].option.flatMap {
        case None => Option.empty[MatchRecord].pure[ConnectionIO]
        case Some(row) => loadPlayersBatch(List(id))
            .map(byMid => byMid.get(id).map(p => toRecord(row, p)))
      }

    override def list(filter: MatchesRepository.ListFilter): ConnectionIO[List[MatchRecord]] =
      val conditions = List(
        filter.heldEventId.map(id => fr"held_event_id = $id"),
        filter.gameTitleId.map(id => fr"game_title_id = $id"),
        filter.seasonMasterId.map(id => fr"season_master_id = $id"),
        filter.matchId.map(id => fr"id = $id"),
      ).flatten
      val where = fragments.whereAndOpt(conditions)
      val limit = filter.limit.map(n => fr"LIMIT $n").getOrElse(Fragment.empty)
      for
        rows <- (selectMatch ++ where ++ fr"ORDER BY played_at DESC, created_at DESC" ++ limit)
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_.id))
      yield rows.flatMap(r => byMid.get(r.id).map(p => toRecord(r, p)))

    override def listByHeldEvent(heldEventId: HeldEventId): ConnectionIO[List[MatchRecord]] =
      for
        rows <-
        (selectMatch ++ fr"WHERE held_event_id = $heldEventId" ++ fr"ORDER BY match_no_in_event")
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_.id))
      yield rows.flatMap(r => byMid.get(r.id).map(p => toRecord(r, p)))

    override def existsMatchNo(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
    ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = $heldEventId AND match_no_in_event = $matchNoInEvent
        )
      """.query[Boolean].unique

    override def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
        excludeMatchId: MatchId,
    ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = $heldEventId
            AND match_no_in_event = $matchNoInEvent
            AND id <> $excludeMatchId
        )
      """.query[Boolean].unique

    override def maxMatchNo(heldEventId: HeldEventId): ConnectionIO[Int] = sql"""
        SELECT COALESCE(MAX(match_no_in_event), 0)
        FROM matches WHERE held_event_id = $heldEventId
      """.query[Int].unique

    override def countByHeldEvents(
        heldEventIds: List[HeldEventId]
    ): ConnectionIO[Map[HeldEventId, Int]] =
      if heldEventIds.isEmpty then Map.empty[HeldEventId, Int].pure[ConnectionIO]
      else
        val ids = heldEventIds.map(_.value).toArray
        sql"""
            SELECT held_event_id, COUNT(*)::int
            FROM matches
            WHERE held_event_id = ANY($ids)
            GROUP BY held_event_id
          """.query[HeldEventMatchCountRow].to[List].map { rows =>
          val seen = rows.map(row => row.heldEventId -> row.count).toMap
          heldEventIds.map(id => id -> seen.getOrElse(id, 0)).toMap
        }
end PostgresMatches

/** Backwards-compatible class facade. */
final class PostgresMatchesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchesRepository[F]:
  private val delegate: MatchesRepository[F] = MatchesRepository
    .fromAlg(PostgresMatches.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMatchesRepository
