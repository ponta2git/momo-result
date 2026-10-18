package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers,
  HeldEvent,
  HeldEventDetail,
  HeldEventSummary,
  MatchDraftStatus,
  MatchLabels,
  MatchNoInEvent,
  MatchNoteBody,
  PublicId,
  RecordNavigation
}
import momo.api.repositories.HeldEventDetailReadModel

object PostgresHeldEventDetail:
  private final case class MatchRow(
      id: MatchId,
      matchNoInEvent: MatchNoInEvent,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      noteBody: Option[String],
      labels: MatchLabels,
      publicId: Option[PublicId],
  ):
    def withPlayers(
        players: List[HeldEventDetail.Player]
    ): Either[PostgresDataIntegrityException, HeldEventDetail.Match] =
      for
        _ <- FourPlayers.validate(players, players.iterator.map(_.memberId).toSet)(
          _.memberId,
          _.playOrder,
          _.rank,
        ).leftMap(errors =>
          PostgresDataIntegrityException.inconsistentRow(
            "match_players",
            id.value,
            errors.toChain.toList.map(_.message).mkString("; "),
          )
        )
        note <- noteBody.traverse(MatchNoteBody.fromRequiredString).leftMap(message =>
          PostgresDataIntegrityException.inconsistentRow("matches", id.value, message)
        )
      yield HeldEventDetail.Match(
        id,
        matchNoInEvent,
        gameTitleId,
        seasonMasterId,
        ownerMemberId,
        mapMasterId,
        playedAt,
        note.map(_.value),
        players,
        labels,
        publicId,
      )

  def find(id: HeldEventId)(using
      identities: PostgresIdentities): ConnectionIO[Option[HeldEventDetail]] =
    find(id, PostgresPublicIds.Legacy)

  def find(
      id: HeldEventId,
      publicIds: PostgresPublicIds
  )(using ids: PostgresIdentities): ConnectionIO[Option[HeldEventDetail]] =
    readSnapshot(load(id, publicIds))

  def findByPublicId(
      publicId: PublicId,
      publicIds: PostgresPublicIds
  )(using ids: PostgresIdentities): ConnectionIO[Option[HeldEventDetail]] = readSnapshot(
    publicIds.heldEventId(publicId).flatMap(_.traverse(load(_, publicIds))).map(_.flatten)
  )

  private def readSnapshot[A](read: ConnectionIO[A]): ConnectionIO[A] =
    sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run *> read

  private def load(
      id: HeldEventId,
      publicIds: PostgresPublicIds
  )(using ids: PostgresIdentities): ConnectionIO[Option[HeldEventDetail]] =
    for
      event <- eventWithNavigation(id, publicIds)
      detail <- event.traverse { case (heldEvent, previous, next) =>
        for
          _ <- validateReadBudget(id)
          matches <-
          (fr"""
            SELECT ${ids.wireId("m")}, m.match_no_in_event, ${ids.wireId("gt")}, ${ids.wireId(
              "season"
            )},
                   ${ids.wireReference(
              Entity.Members,
              fr"m.owner_member_id"
            )}, ${ids.wireId("map")}, m.played_at, m.note_body,
                   gt.name, season.name, map.name,
          """ ++ publicIds.column(fr"m.public_id") ++ fr"""
            FROM matches m
            LEFT JOIN game_titles gt ON gt.id = m.game_title_id
            LEFT JOIN season_masters season ON season.id = m.season_master_id
            LEFT JOIN map_masters map ON map.id = m.map_master_id
            WHERE m.held_event_id = ${ids.lookup(
              Entity.HeldEvents,
              id.value
            )} ORDER BY m.match_no_in_event
          """).query[MatchRow].to[List]
          matchIds = ids.lookupArray(Entity.Matches, matches.map(_.id.value))
          players <- sql"""
            SELECT ${ids.wireReference(Entity.Matches, fr"p.match_id")}, ${ids.wireReference(
              Entity.Members,
              fr"p.member_id"
            )}, p.play_order, p.rank,
                   p.total_assets_man_yen, p.revenue_man_yen
            FROM match_players p
            WHERE p.match_id = ANY($matchIds)
            ORDER BY ${ids.wireReference(Entity.Matches, fr"p.match_id")}, p.play_order
          """.query[(MatchId, HeldEventDetail.Player)].to[List]
          drafts <- sql"""
            SELECT ${ids.wireId("d")}, d.status, d.match_no_in_event, ${ids.wireId(
              "gt"
            )}, ${ids.wireId("season")},
                   ${ids.wireId("map")}, d.played_at, d.updated_at,
                   gt.name, season.name, map.name
            FROM match_drafts d
            LEFT JOIN game_titles gt ON gt.id = d.game_title_id
            LEFT JOIN season_masters season ON season.id = d.season_master_id
            LEFT JOIN map_masters map ON map.id = d.map_master_id
            WHERE d.held_event_id = ${ids.lookup(Entity.HeldEvents, id.value)}
              AND d.status <> ${MatchDraftStatus.Cancelled}
              AND d.status <> ${MatchDraftStatus.Confirmed}
            ORDER BY d.match_no_in_event ASC NULLS LAST, d.updated_at DESC, ${ids.wireId("d")} ASC
          """.query[HeldEventDetail.Draft].to[List]
          byMatch = players.groupMap(_._1)(_._2)
          confirmed <-
            matches.traverse(m => m.withPlayers(byMatch.getOrElse(m.id, Nil))).liftTo[ConnectionIO]
        yield HeldEventDetail(heldEvent, confirmed, drafts, RecordNavigation(previous, next))
      }
    yield detail

  private def validateReadBudget(id: HeldEventId)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    val limit = PostgresReadBudget.HeldEventRecords
    val nameLimit = PostgresReadBudget.NameCodePoints
    val noteLimit = MatchNoteBody.MaximumCodePoints
    sql"""
      SELECT counts.records,
        CASE WHEN counts.records <= $limit THEN NOT EXISTS (
          SELECT 1 FROM matches m
          LEFT JOIN game_titles gt ON gt.id = m.game_title_id
          LEFT JOIN season_masters season ON season.id = m.season_master_id
          LEFT JOIN map_masters map ON map.id = m.map_master_id
          WHERE m.held_event_id = ${ids.lookup(Entity.HeldEvents, id.value)} AND (
            char_length(gt.name) > $nameLimit OR char_length(season.name) > $nameLimit
            OR char_length(map.name) > $nameLimit OR char_length(m.note_body) > $noteLimit
          )
          UNION ALL
          SELECT 1 FROM match_drafts d
          LEFT JOIN game_titles gt ON gt.id = d.game_title_id
          LEFT JOIN season_masters season ON season.id = d.season_master_id
          LEFT JOIN map_masters map ON map.id = d.map_master_id
          WHERE d.held_event_id = ${ids.lookup(Entity.HeldEvents, id.value)}
            AND d.status <> ${MatchDraftStatus.Cancelled}
            AND d.status <> ${MatchDraftStatus.Confirmed}
            AND (char_length(gt.name) > $nameLimit OR char_length(season.name) > $nameLimit
              OR char_length(map.name) > $nameLimit)
        ) ELSE TRUE END
      FROM (
        SELECT COUNT(*) AS records FROM (
          SELECT 1 FROM matches WHERE held_event_id = ${ids.lookup(Entity.HeldEvents, id.value)}
          UNION ALL
          SELECT 1 FROM match_drafts WHERE held_event_id = ${ids.lookup(
        Entity.HeldEvents,
        id.value
      )}
            AND status <> ${MatchDraftStatus.Cancelled}
            AND status <> ${MatchDraftStatus.Confirmed}
          LIMIT ${limit + 1}
        ) bounded
      ) counts
    """.query[(Long, Boolean)].unique.flatMap { case (count, validText) =>
      PostgresReadBudget.ensureCount(count.pure[ConnectionIO], limit, "Held-event detail") *>
        PostgresReadBudget.ensureText(validText.pure[ConnectionIO], "Held-event detail")
    }

  private def eventWithNavigation(
      id: HeldEventId,
      publicIds: PostgresPublicIds,
  )(using ids: PostgresIdentities)
      : ConnectionIO[Option[(HeldEvent, Option[HeldEvent], Option[HeldEvent])]] =
    (fr"""
    SELECT ${ids.wireId("current")}, current.start_at,
  """ ++ publicIds.column(fr"current.public_id") ++ fr""",
    previous.id, previous.start_at, previous.public_id, next.id, next.start_at, next.public_id
    FROM held_events current
    LEFT JOIN LATERAL (
      SELECT ${ids.wireId("held_events")} AS id, start_at,
  """ ++ publicIds.column(fr"public_id") ++ fr""" AS public_id FROM held_events
      WHERE (start_at, ${ids.wireId(
        "held_events"
      )} COLLATE "C") < (current.start_at, ${ids.wireId("current")} COLLATE "C")
      ORDER BY start_at DESC, ${ids.wireId("held_events")} COLLATE "C" DESC LIMIT 1
    ) previous ON TRUE
    LEFT JOIN LATERAL (
      SELECT ${ids.wireId("held_events")} AS id, start_at,
  """ ++ publicIds.column(fr"public_id") ++ fr""" AS public_id FROM held_events
      WHERE (start_at, ${ids.wireId("held_events")} COLLATE "C") > (current.start_at, ${ids.wireId(
        "current"
      )} COLLATE "C")
      ORDER BY start_at ASC, ${ids.wireId("held_events")} COLLATE "C" ASC LIMIT 1
    ) next ON TRUE
    WHERE current.id = ${ids.lookup(Entity.HeldEvents, id.value)}
  """).query[(HeldEvent, Option[HeldEvent], Option[HeldEvent])].option

  def summary(
      id: HeldEventId,
      publicIds: PostgresPublicIds
  )(using ids: PostgresIdentities): ConnectionIO[Option[HeldEventSummary]] =
    (fr"""
    SELECT ${ids.wireId("he")}, he.start_at,
  """ ++ publicIds.column(fr"he.public_id") ++ fr""", confirmed.count, draft.count,
           GREATEST(confirmed.max_no, draft.max_no) + 1
    FROM held_events he
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS count, COALESCE(MAX(match_no_in_event), 0)::int AS max_no
      FROM matches WHERE held_event_id = he.id
    ) confirmed
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS count, COALESCE(MAX(match_no_in_event), 0)::int AS max_no
      FROM match_drafts WHERE held_event_id = he.id
        AND status <> ${MatchDraftStatus.Cancelled} AND status <> ${MatchDraftStatus.Confirmed}
    ) draft
    WHERE he.id = ${ids.lookup(Entity.HeldEvents, id.value)}
  """).query[HeldEventSummary].option

final class PostgresHeldEventDetailReadModel[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    publicIds: PostgresPublicIds = PostgresPublicIds.Legacy,
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends HeldEventDetailReadModel[F]:
  private given PostgresIdentities = identities
  override def find(id: HeldEventId): F[Option[HeldEventDetail]] =
    PostgresHeldEventDetail.find(id, publicIds).transact(transactor)

  override def findByPublicId(publicId: PublicId): F[Option[HeldEventDetail]] =
    PostgresHeldEventDetail.findByPublicId(publicId, publicIds).transact(transactor)

  override def summary(id: HeldEventId): F[Option[HeldEventSummary]] =
    PostgresHeldEventDetail.summary(id, publicIds).transact(transactor)
