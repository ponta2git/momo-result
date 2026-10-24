package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}

/** Event membership is guarded before match, achievement and analysis rows on every writer. */
private[postgres] object PostgresAchievementMatchLocks:
  final case class MatchSource(
      id: MatchId,
      heldEventId: HeldEventId,
      gameTitleId: GameTitleId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      version: Long,
  )

  def lockEvents(events: List[HeldEventId])(using ids: PostgresIdentities): ConnectionIO[Unit] =
    if events.isEmpty then ().pure[ConnectionIO]
    else
      val selected = ids.lookupArray(Entity.HeldEvents, events.map(_.value).distinct)
      sql"""SELECT ${ids.wireId("held_events")} FROM held_events
        WHERE id = ANY($selected) ORDER BY ${ids.wireId("held_events")} COLLATE "C" FOR UPDATE
      """.query[HeldEventId].to[List].flatMap(found =>
        if found.size == events.distinct.size then ().pure[ConnectionIO]
        else
          new AppException(AppError.Conflict("A held event changed before saving."))
            .raiseError[ConnectionIO, Unit]
      )

  def lockMatches(matches: List[MatchId])(using
      PostgresIdentities): ConnectionIO[List[MatchSource]] =
    lockMatches(matches, Nil)

  def lockMatches(
      matches: List[MatchId],
      extraEvents: List[HeldEventId],
  )(using ids: PostgresIdentities): ConnectionIO[List[MatchSource]] =
    val selected = ids.lookupArray(Entity.Matches, matches.map(_.value).distinct)
    for
      before <- if matches.isEmpty then List.empty[HeldEventId].pure[ConnectionIO]
      else sql"""SELECT DISTINCT ${ids.wireReference(Entity.HeldEvents, fr"m.held_event_id")}
        FROM matches m WHERE m.id = ANY($selected)""".query[HeldEventId].to[List]
      events = (before ++ extraEvents).distinct
      _ <- lockEvents(events)
      locked <- if matches.isEmpty then List.empty[MatchSource].pure[ConnectionIO]
      else
        sql"""SELECT ${ids.wireId("m")},
        ${ids.wireReference(Entity.HeldEvents, fr"m.held_event_id")},
        ${ids.wireReference(Entity.GameTitles, fr"m.game_title_id")},
        ${ids.wireReference(Entity.MapMasters, fr"m.map_master_id")},
        m.played_at, m.analysis_revision
        FROM matches m WHERE m.id = ANY($selected)
        ORDER BY ${ids.wireId("m")} COLLATE "C" FOR UPDATE
      """.query[MatchSource].to[List]
      _ <- if locked.forall(value => events.contains(value.heldEventId)) then ().pure[ConnectionIO]
      else
        new AppException(
          AppError.Conflict("A match moved to another event. Refresh before saving.")
        )
          .raiseError[ConnectionIO, Unit]
    yield locked

  def affectedTitles(events: List[HeldEventId])(using ids: PostgresIdentities)
      : ConnectionIO[List[GameTitleId]] =
    if events.isEmpty then List.empty[GameTitleId].pure[ConnectionIO]
    else
      val selected = ids.lookupArray(Entity.HeldEvents, events.map(_.value).distinct)
      sql"""SELECT DISTINCT ${ids.wireReference(Entity.GameTitles, fr"m.game_title_id")}
        FROM matches m WHERE m.held_event_id = ANY($selected)
      """.query[GameTitleId].to[List]
