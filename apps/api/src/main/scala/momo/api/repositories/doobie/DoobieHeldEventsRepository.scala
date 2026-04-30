package momo.api.repositories.doobie

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import momo.api.domain.HeldEvent
import momo.api.repositories.HeldEventsRepository

import java.time.LocalDate
import java.time.ZoneId

/** `held_events` 行を読み書きする。本アプリで作成する ad-hoc な開催履歴は
  * `session_id IS NULL` で挿入する（summit が作る出席 session 由来の行は
  * このリポジトリでは生成しない）。
  *
  * `held_date_iso` は表示用日付として `start_at` を Asia/Tokyo に変換した
  * `LocalDate` で埋める。`heldAt` だけが Scala 側のドメインで保持される。
  */
final class DoobieHeldEventsRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends HeldEventsRepository[F]:

  private val Jst = ZoneId.of("Asia/Tokyo")

  override def list(query: Option[String], limit: Int): F[List[HeldEvent]] =
    val base = fr"SELECT id, start_at FROM held_events"
    val where = query
      .map(_.trim)
      .filter(_.nonEmpty)
      .fold(Fragment.empty) { q =>
        val like = s"%$q%"
        fr"WHERE id ILIKE $like"
      }
    val order = fr"ORDER BY start_at DESC, id DESC"
    val lim = fr"LIMIT ${math.max(limit, 0)}"
    (base ++ where ++ order ++ lim).query[HeldEvent].to[List].transact(xa)

  override def find(id: String): F[Option[HeldEvent]] =
    sql"""
      SELECT id, start_at FROM held_events WHERE id = $id
    """.query[HeldEvent].option.transact(xa)

  override def create(event: HeldEvent): F[Unit] =
    val heldDateIso: LocalDate = event.heldAt.atZone(Jst).toLocalDate
    sql"""
      INSERT INTO held_events (id, session_id, held_date_iso, start_at, created_at)
      VALUES (${event.id}, NULL, $heldDateIso, ${event.heldAt}, ${event.heldAt})
    """.update.run.void.transact(xa)
