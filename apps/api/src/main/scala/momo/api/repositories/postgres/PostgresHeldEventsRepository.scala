package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import java.time.{LocalDate, ZoneId}
import momo.api.domain.HeldEvent
import momo.api.repositories.HeldEventsRepository

/**
 * `held_events` 行を読み書きする。本アプリで作成する ad-hoc な開催履歴は `session_id IS NULL` で挿入する（summit が作る出席 session
 * 由来の行は このリポジトリでは生成しない）。
 *
 * `held_date_iso` は表示用日付として `start_at` を Asia/Tokyo に変換した `LocalDate` で埋める。`heldAt` だけが Scala
 * 側のドメインで保持される。
 */
final class PostgresHeldEventsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends HeldEventsRepository[F]:

  private val Jst = ZoneId.of("Asia/Tokyo")

  override def list(query: Option[String], limit: Int): F[List[HeldEvent]] =
    val base = fr"SELECT id, start_at FROM held_events"
    val where = query.map(_.trim).filter(_.nonEmpty).fold(Fragment.empty) { q =>
      val like = s"%$q%"
      fr"WHERE id ILIKE $like"
    }
    val order = fr"ORDER BY start_at DESC, id DESC"
    val lim = fr"LIMIT ${math.max(limit, 0)}"
    (base ++ where ++ order ++ lim).query[HeldEvent].to[List].transact(transactor)

  override def find(id: String): F[Option[HeldEvent]] = sql"""
      SELECT id, start_at FROM held_events WHERE id = $id
    """.query[HeldEvent].option.transact(transactor)

  override def create(event: HeldEvent): F[Unit] =
    val heldDateIso: LocalDate = event.heldAt.atZone(Jst).toLocalDate
    sql"""
      INSERT INTO held_events (id, session_id, held_date_iso, start_at, created_at)
      VALUES (${event.id}, NULL, $heldDateIso, ${event.heldAt}, ${event.heldAt})
    """.update.run.void.transact(transactor)
