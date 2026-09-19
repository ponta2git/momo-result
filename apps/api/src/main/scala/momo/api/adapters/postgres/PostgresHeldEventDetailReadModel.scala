package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{FourPlayers, HeldEventDetail, HeldEventSummary, MatchDraftStatus, MatchLabels, MatchNoInEvent, MatchNoteBody}
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
  ):
    def withPlayers(
        players: List[HeldEventDetail.Player]
    ): Either[PostgresDataIntegrityException, HeldEventDetail.Match] =
      for
        _ <- FourPlayers.validate(players, players.iterator.map(_.memberId).toSet)(
          _.memberId, _.playOrder, _.rank,
        ).leftMap(errors => PostgresDataIntegrityException.inconsistentRow(
          "match_players", id.value, errors.toChain.toList.map(_.message).mkString("; "),
        ))
        note <- noteBody.traverse(MatchNoteBody.fromRequiredString).leftMap(message =>
          PostgresDataIntegrityException.inconsistentRow("matches", id.value, message)
        )
      yield HeldEventDetail.Match(
        id, matchNoInEvent, gameTitleId, seasonMasterId, ownerMemberId, mapMasterId,
        playedAt, note.map(_.value), players, labels,
      )

  def find(id: HeldEventId): ConnectionIO[Option[HeldEventDetail]] =
    for
      _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
      event <- PostgresHeldEvents.alg.find(id)
      detail <- event.traverse { heldEvent =>
        for
          matches <- sql"""
            SELECT m.id, m.match_no_in_event, m.game_title_id, m.season_master_id,
                   m.owner_member_id, m.map_master_id, m.played_at, m.note_body,
                   gt.name, season.name, map.name
            FROM matches m
            LEFT JOIN game_titles gt ON gt.id = m.game_title_id
            LEFT JOIN season_masters season ON season.id = m.season_master_id
            LEFT JOIN map_masters map ON map.id = m.map_master_id
            WHERE m.held_event_id = $id ORDER BY m.match_no_in_event
          """.query[MatchRow].to[List]
          matchIds = matches.map(_.id.value).toArray
          players <- sql"""
            SELECT p.match_id, p.member_id, p.play_order, p.rank,
                   p.total_assets_man_yen, p.revenue_man_yen
            FROM match_players p
            WHERE p.match_id = ANY($matchIds)
            ORDER BY p.match_id, p.play_order
          """.query[(MatchId, HeldEventDetail.Player)].to[List]
          drafts <- sql"""
            SELECT d.id, d.status, d.match_no_in_event, d.game_title_id, d.season_master_id,
                   d.map_master_id, d.played_at, d.updated_at,
                   gt.name, season.name, map.name
            FROM match_drafts d
            LEFT JOIN game_titles gt ON gt.id = d.game_title_id
            LEFT JOIN season_masters season ON season.id = d.season_master_id
            LEFT JOIN map_masters map ON map.id = d.map_master_id
            WHERE d.held_event_id = $id
              AND d.status <> ${MatchDraftStatus.Cancelled}
              AND d.status <> ${MatchDraftStatus.Confirmed}
            ORDER BY d.match_no_in_event ASC NULLS LAST, d.updated_at DESC, d.id ASC
          """.query[HeldEventDetail.Draft].to[List]
          byMatch = players.groupMap(_._1)(_._2)
          confirmed <- matches.traverse(m => m.withPlayers(byMatch.getOrElse(m.id, Nil))).liftTo[ConnectionIO]
        yield HeldEventDetail(heldEvent, confirmed, drafts)
      }
    yield detail

  def summary(id: HeldEventId): ConnectionIO[Option[HeldEventSummary]] = sql"""
    SELECT he.id, he.start_at, confirmed.count, draft.count,
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
    WHERE he.id = $id
  """.query[HeldEventSummary].option

final class PostgresHeldEventDetailReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends HeldEventDetailReadModel[F]:
  override def find(id: HeldEventId): F[Option[HeldEventDetail]] =
    PostgresHeldEventDetail.find(id).transact(transactor)

  override def summary(id: HeldEventId): F[Option[HeldEventSummary]] =
    PostgresHeldEventDetail.summary(id).transact(transactor)
