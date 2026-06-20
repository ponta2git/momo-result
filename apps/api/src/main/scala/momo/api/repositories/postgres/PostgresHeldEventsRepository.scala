package momo.api.repositories.postgres

import java.time.{LocalDate, ZoneId}

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.db.Database
import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, MatchDraftStatus, PageRequest, PagedResult}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  HeldEventDeletionAlg,
  HeldEventDeletionRepository,
  HeldEventDeletionResult,
  HeldEventsAlg,
  HeldEventsRepository
}

/**
 * `held_events` の純粋 [[HeldEventsAlg]] と、それを `Transactor[F]` で持ち上げた facade。
 *
 * 本アプリで作成する ad-hoc な開催履歴は `session_id IS NULL` で挿入する。`held_date_iso` は表示用日付として `start_at` を
 * Asia/Tokyo に変換した `LocalDate` で埋める。`heldAt` だけが Scala 側のドメインで保持される。
 */
object PostgresHeldEvents:

  private val Jst = ZoneId.of("Asia/Tokyo")
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  private def whereQuery(query: Option[String]): Fragment = query.map(_.trim).filter(_.nonEmpty)
    .fold(Fragment.empty) { q =>
      val like = s"%$q%"
      fr"WHERE id ILIKE $like"
    }

  val alg: HeldEventsAlg[ConnectionIO] = new HeldEventsAlg[ConnectionIO]:
    override def list(query: Option[String], limit: Int): ConnectionIO[List[HeldEvent]] =
      val base = fr"SELECT id, start_at FROM held_events"
      val where = whereQuery(query)
      val order = fr"ORDER BY start_at DESC, id DESC"
      val lim = fr"LIMIT ${math.max(limit, 0)}"
      (base ++ where ++ order ++ lim).query[HeldEvent].to[List]

    override def listPage(
        query: Option[String],
        page: PageRequest,
    ): ConnectionIO[PagedResult[HeldEvent]] =
      val base = fr"SELECT id, start_at FROM held_events"
      val where = whereQuery(query)
      val order = fr"ORDER BY start_at DESC, id DESC"
      val pageLimit = fr"LIMIT ${page.pageSize} OFFSET ${page.offset}"
      for
        total <- (fr"SELECT COUNT(*)::int FROM held_events" ++ where).query[Int].unique
        items <- (base ++ where ++ order ++ pageLimit).query[HeldEvent].to[List]
      yield PagedResult(items, page, total)

    override def listIds(query: Option[String]): ConnectionIO[List[HeldEventId]] =
      (fr"SELECT id FROM held_events" ++ whereQuery(query) ++ fr"ORDER BY start_at DESC, id DESC")
        .query[HeldEventId].to[List]

    override def find(id: HeldEventId): ConnectionIO[Option[HeldEvent]] = sql"""
        SELECT id, start_at FROM held_events WHERE id = $id
      """.query[HeldEvent].option

    override def create(event: HeldEvent): ConnectionIO[Unit] =
      val heldDateIso: LocalDate = event.heldAt.atZone(Jst).toLocalDate
      sql"""
        INSERT INTO held_events (id, session_id, held_date_iso, start_at, created_at)
        VALUES (${event.id}, NULL, $heldDateIso, ${event.heldAt}, ${event.heldAt})
      """.update.run.void.exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"held event already exists: ${event.id.value}")
      }

    override def delete(id: HeldEventId): ConnectionIO[Boolean] = sql"""
        DELETE FROM held_events WHERE id = $id
      """.update.run.map(_ > 0)
end PostgresHeldEvents

object PostgresHeldEventDeletion:
  private def isForeignKeyViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.FOREIGN_KEY_VIOLATION.value

  private type DeletionState = (Boolean, Boolean, Boolean, Boolean)

  private def deleteDiscardedDrafts(id: HeldEventId): ConnectionIO[Int] = sql"""
    DELETE FROM match_drafts
    WHERE held_event_id = $id
      AND (
        status = ${MatchDraftStatus.Cancelled}
        OR (status = ${MatchDraftStatus.Confirmed} AND confirmed_match_id IS NULL)
      )
  """.update.run

  val alg: HeldEventDeletionAlg[ConnectionIO] = new HeldEventDeletionAlg[ConnectionIO]:
    override def deleteIfUnreferenced(id: HeldEventId): ConnectionIO[HeldEventDeletionResult] =
      deleteDiscardedDrafts(id) *> sql"""
        WITH target AS (
          SELECT id FROM held_events WHERE id = $id
        ),
        reference_state AS (
          SELECT
            EXISTS(SELECT 1 FROM matches WHERE held_event_id = $id) AS has_matches,
            EXISTS(SELECT 1 FROM match_drafts WHERE held_event_id = $id) AS has_drafts
        ),
        deleted AS (
          DELETE FROM held_events
          WHERE id = $id
            AND EXISTS (SELECT 1 FROM target)
            AND NOT EXISTS (SELECT 1 FROM matches WHERE held_event_id = $id)
            AND NOT EXISTS (SELECT 1 FROM match_drafts WHERE held_event_id = $id)
          RETURNING id
        )
        SELECT
          EXISTS(SELECT 1 FROM target) AS found,
          (SELECT has_matches FROM reference_state) AS has_matches,
          (SELECT has_drafts FROM reference_state) AS has_drafts,
          EXISTS(SELECT 1 FROM deleted) AS deleted
      """.query[DeletionState].unique.map {
        case (_, _, _, true) => HeldEventDeletionResult.Deleted
        case (false, _, _, false) => HeldEventDeletionResult.NotFound
        case (true, true, _, false) => HeldEventDeletionResult.HasConfirmedMatches
        case (true, false, true, false) => HeldEventDeletionResult.HasMatchDrafts
        case _ => HeldEventDeletionResult.Referenced
      }.exceptSomeSqlState {
        case state if isForeignKeyViolation(state) =>
          MonadThrow[ConnectionIO].pure(HeldEventDeletionResult.Referenced)
      }
end PostgresHeldEventDeletion

/**
 * Backwards-compatible class facade so existing wiring (`new PostgresHeldEventsRepository(xa)`)
 * keeps working while new callers may consume [[PostgresHeldEvents.alg]] in `ConnectionIO`.
 */
final class PostgresHeldEventsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends HeldEventsRepository[F]:
  private val delegate: HeldEventsRepository[F] = HeldEventsRepository
    .fromAlg(PostgresHeldEvents.alg, Database.transactK(transactor))

  export delegate.*
end PostgresHeldEventsRepository

final class PostgresHeldEventDeletionRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends HeldEventDeletionRepository[F]:
  private val delegate: HeldEventDeletionRepository[F] = HeldEventDeletionRepository
    .fromAlg(PostgresHeldEventDeletion.alg, Database.transactK(transactor))

  export delegate.*
end PostgresHeldEventDeletionRepository
