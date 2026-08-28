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

import momo.api.adapters.postgres.PostgresMatchInsertOps.replaceMatchChildren
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisMutationOps.enqueueMatchMutation
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
    override def update(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
      val previousTitle = sql"""
        SELECT game_title_id
        FROM matches
        WHERE id = ${record.id}
        FOR UPDATE
      """.query[GameTitleId].option.flatMap {
        case Some(value) => value.pure[ConnectionIO]
        case None => notFound[GameTitleId]("match", record.id.value)
      }
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
            analysis_revision = analysis_revision + 1,
            updated_at = $updatedAt
        WHERE id = ${record.id}
      """.update.run
      (for
        oldTitle <- previousTitle
        affected <- updateMatch
        _ <- if affected == 1 then replaceMatchChildren(record)
        else notFound[Unit]("match", record.id.value)
        _ <- enqueueMatchMutation(List(oldTitle, record.gameTitleId))
      yield ()).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
              .toString} already exists for held event ${record.heldEventId.value}.")
      }

    override def delete(id: MatchId): ConnectionIO[Boolean] =
      for
        oldTitle <- sql"""
          SELECT game_title_id
          FROM matches
          WHERE id = $id
          FOR UPDATE
        """.query[GameTitleId].option
        _ <- sql"DELETE FROM match_drafts WHERE confirmed_match_id = $id".update.run
        deleted <- sql"DELETE FROM matches WHERE id = $id".update.run.map(_ > 0)
        _ <- oldTitle.filter(_ => deleted).toList.traverse_(title =>
          enqueueMatchMutation(List(title))
        )
      yield deleted

    override def find(id: MatchId): ConnectionIO[Option[MatchRecord]] =
      (selectMatch ++ fr"WHERE id = $id").query[MatchRow].option.flatMap {
        case None => Option.empty[MatchRecord].pure[ConnectionIO]
        case Some(row) => loadPlayersBatch(List(id))
            .flatMap(byMid => byMid.get(id).traverse(p => toRecord(row, p)))
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
        records <- rows.traverse(r => byMid.get(r.id).traverse(p => toRecord(r, p)))
      yield records.flatten

    override def listByHeldEvent(heldEventId: HeldEventId): ConnectionIO[List[MatchRecord]] =
      for
        rows <-
        (selectMatch ++ fr"WHERE held_event_id = $heldEventId" ++ fr"ORDER BY match_no_in_event")
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_.id))
        records <- rows.traverse(r => byMid.get(r.id).traverse(p => toRecord(r, p)))
      yield records.flatten

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

    override def statsByHeldEvents(
        heldEventIds: List[HeldEventId]
    ): ConnectionIO[Map[HeldEventId, MatchesRepository.HeldEventStats]] =
      if heldEventIds.isEmpty then
        Map.empty[HeldEventId, MatchesRepository.HeldEventStats].pure[ConnectionIO]
      else
        val ids = heldEventIds.map(_.value).toArray
        sql"""
            SELECT held_event_id, COUNT(*)::int, COALESCE(MAX(match_no_in_event), 0)::int
            FROM matches
            WHERE held_event_id = ANY($ids)
            GROUP BY held_event_id
          """.query[HeldEventMatchStatsRow].to[List].map { rows =>
          val seen = rows.map(row =>
            row.heldEventId -> MatchesRepository.HeldEventStats(
              matchCount = row.count,
              maxMatchNo = row.maxMatchNo,
            )
          ).toMap
          heldEventIds.map(id => id -> seen.getOrElse(id, MatchesRepository.HeldEventStats(0, 0)))
            .toMap
        }
end PostgresMatches

final class PostgresMatchesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchesRepository[F]:
  private val delegate: MatchesRepository[F] = MatchesRepository
    .fromAlg(PostgresMatches.alg, transactor.trans)

  export delegate.*
end PostgresMatchesRepository
