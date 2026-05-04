package momo.api.repositories.postgres

import java.time.{LocalDate, ZoneId}

import cats.effect.MonadCancelThrow
import cats.syntax.functor.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{HeldEventsAlg, HeldEventsRepository}

/**
 * `held_events` の純粋 [[HeldEventsAlg]] と、それを `Transactor[F]` で持ち上げた facade。
 *
 * 本アプリで作成する ad-hoc な開催履歴は `session_id IS NULL` で挿入する。`held_date_iso` は表示用日付として `start_at` を
 * Asia/Tokyo に変換した `LocalDate` で埋める。`heldAt` だけが Scala 側のドメインで保持される。
 */
object PostgresHeldEvents:

  private val Jst = ZoneId.of("Asia/Tokyo")

  val alg: HeldEventsAlg[ConnectionIO] = new HeldEventsAlg[ConnectionIO]:
    override def list(query: Option[String], limit: Int): ConnectionIO[List[HeldEvent]] =
      val base = fr"SELECT id, start_at FROM held_events"
      val where = query.map(_.trim).filter(_.nonEmpty).fold(Fragment.empty) { q =>
        val like = s"%$q%"
        fr"WHERE id ILIKE $like"
      }
      val order = fr"ORDER BY start_at DESC, id DESC"
      val lim = fr"LIMIT ${math.max(limit, 0)}"
      (base ++ where ++ order ++ lim).query[HeldEvent].to[List]

    override def find(id: HeldEventId): ConnectionIO[Option[HeldEvent]] = sql"""
        SELECT id, start_at FROM held_events WHERE id = $id
      """.query[HeldEvent].option

    override def create(event: HeldEvent): ConnectionIO[Unit] =
      val heldDateIso: LocalDate = event.heldAt.atZone(Jst).toLocalDate
      sql"""
        INSERT INTO held_events (id, session_id, held_date_iso, start_at, created_at)
        VALUES (${event.id}, NULL, $heldDateIso, ${event.heldAt}, ${event.heldAt})
      """.update.run.void
end PostgresHeldEvents

/**
 * Backwards-compatible class facade so existing wiring (`new PostgresHeldEventsRepository(xa)`)
 * keeps working while new callers may consume [[PostgresHeldEvents.alg]] in `ConnectionIO`.
 */
final class PostgresHeldEventsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends HeldEventsRepository[F]:
  private val delegate: HeldEventsRepository[F] = HeldEventsRepository
    .fromConnectionIO(PostgresHeldEvents.alg, Database.transactK(transactor))

  override def list(query: Option[String], limit: Int): F[List[HeldEvent]] = delegate
    .list(query, limit)
  override def find(id: HeldEventId): F[Option[HeldEvent]] = delegate.find(id)
  override def create(event: HeldEvent): F[Unit] = delegate.create(event)
end PostgresHeldEventsRepository
