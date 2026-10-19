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

import momo.api.adapters.postgres.PostgresMatchInsertOps.replaceMatchChildren
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisMutationOps.enqueueMatchMutation
import momo.api.domain.ids.*
import momo.api.domain.{MatchNoInEvent, MatchRecord, MatchUpdate}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MatchesAlg, MatchesRepository}

/**
 * Persists `matches` along with their dependent `match_players` (4 rows) and `match_incidents` (4 ×
 * 6 = 24 rows) atomically in a single connection. Updates merge omitted fields from the locked
 * parent; reads batch the player and incident rows.
 */
object PostgresMatches extends PostgresMatchesReadSupport:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  private def notFound[A](resource: String, id: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.NotFound(resource, id)))

  val alg: MatchesAlg[ConnectionIO] = new MatchesAlg[ConnectionIO]:
    override def update(
        id: MatchId,
        change: MatchUpdate,
        updatedAt: Instant
    ): ConnectionIO[MatchRecord] =
      val current = (selectMatch ++ fr"WHERE id = $id FOR UPDATE").query[MatchRow].option.flatMap {
        case Some(row) => toRecord(row, change.input.players).liftTo[ConnectionIO]
        case None => notFound[MatchRecord]("match", id.value)
      }
      def updateMatch(record: MatchRecord) = sql"""
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
        previous <- current
        oldTitle = previous.gameTitleId
        record = change.applyTo(previous)
        previousRadarInput <- PostgresSeriesPlayerRadarMutationOps.inputIdentity(record.id)
        affected <- updateMatch(record)
        _ <- if affected == 1 then replaceMatchChildren(record)
        else notFound[Unit]("match", record.id.value)
        _ <- enqueueMatchMutation(List(oldTitle, record.gameTitleId))
        currentRadarInput <- PostgresSeriesPlayerRadarMutationOps.inputIdentity(record.id)
        _ <- if previousRadarInput != currentRadarInput then
          PostgresSeriesPlayerRadarMutationOps.changed(
            List(oldTitle, record.gameTitleId),
            record.id,
            true
          )
        else ().pure[ConnectionIO]
      yield record).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[MatchRecord](s"matchNoInEvent ${change.input.matchNoInEvent.value
              .toString} already exists for held event ${change.input.heldEventId.value}.")
        case state if isForeignKeyViolation(state) =>
          conflict[MatchRecord]("Match prerequisites changed before the update completed.")
      }

    override def delete(id: MatchId): ConnectionIO[Boolean] =
      for
        oldTitle <- sql"""
          SELECT game_title_id
          FROM matches
          WHERE id = $id
          FOR UPDATE
        """.query[GameTitleId].option
        _ <- sql"SELECT id FROM match_drafts WHERE confirmed_match_id = $id ORDER BY id FOR UPDATE"
          .query[MatchDraftId].to[List]
        deletedDrafts <- sql"DELETE FROM match_drafts WHERE confirmed_match_id = $id RETURNING id"
          .query[MatchDraftId].to[List]
        deleted <- sql"DELETE FROM matches WHERE id = $id".update.run.map(_ > 0)
        _ <- oldTitle.filter(_ => deleted).toList.traverse_(title =>
          enqueueMatchMutation(List(title)) *>
            PostgresSeriesPlayerRadarMutationOps.changed(List(title), id, true)
        )
        _ <- PostgresResultNotificationCancellation.afterDeletion(
          deletedDrafts,
          List(id).filter(_ => deleted)
        )
      yield deleted

    override def find(id: MatchId): ConnectionIO[Option[MatchRecord]] =
      (selectMatch ++ fr"WHERE id = $id").query[MatchRow].option.flatMap {
        case None => Option.empty[MatchRecord].pure[ConnectionIO]
        case Some(row) => loadPlayersBatch(List(id))
            .flatMap(byMid => byMid.get(id).traverse(p => toRecord(row, p).liftTo[ConnectionIO]))
      }

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

end PostgresMatches

final class PostgresMatchesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchesRepository[F]:
  private val delegate: MatchesRepository[F] = MatchesRepository
    .fromAlg(PostgresMatches.alg, transactor.trans)

  export delegate.{update, delete, existsMatchNo, existsMatchNoExcept}

  override def find(id: MatchId): F[Option[MatchRecord]] =
    readSnapshot(PostgresMatches.alg.find(id))

  private def readSnapshot[A](read: ConnectionIO[A]): F[A] =
    (sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run *> read)
      .transact(transactor)
end PostgresMatchesRepository
