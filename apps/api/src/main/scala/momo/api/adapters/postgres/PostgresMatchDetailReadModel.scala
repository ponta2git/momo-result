package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.MatchId
import momo.api.domain.{
  AdjacentMatch,
  MatchDetail,
  MatchIdentity,
  MatchLabels,
  MatchRecord,
  PublicId,
  RecordNavigation
}
import momo.api.repositories.MatchDetailReadModel

object PostgresMatchDetail:
  private final case class Metadata(
      heldAt: Instant,
      labels: MatchLabels,
      noteUpdatedByDisplayName: Option[String],
      publicId: Option[PublicId],
      heldEventPublicId: Option[PublicId],
  )

  def find(id: MatchId): ConnectionIO[Option[MatchDetail]] =
    find(id, PostgresPublicIds.Legacy)

  def find(
      id: MatchId,
      publicIds: PostgresPublicIds
  ): ConnectionIO[Option[MatchDetail]] =
    readSnapshot(load(id, publicIds))

  def findByPublicId(
      publicId: PublicId,
      publicIds: PostgresPublicIds
  ): ConnectionIO[Option[MatchDetail]] = readSnapshot(
    publicIds.matchId(publicId).flatMap(_.traverse(load(_, publicIds))).map(_.flatten)
  )

  private def readSnapshot[A](read: ConnectionIO[A]): ConnectionIO[A] =
    sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run *> read

  private def load(id: MatchId, publicIds: PostgresPublicIds): ConnectionIO[Option[MatchDetail]] =
    for
      record <- PostgresMatches.alg.find(id)
      detail <- record.traverse { value =>
        for
          metadata <-
          (fr"""
          SELECT he.start_at, gt.name, season.name, map.name, account.display_name,
        """ ++ publicIds.column(fr"m.public_id") ++ fr"," ++ publicIds.column(fr"he.public_id") ++
            fr"""
          FROM matches m
          JOIN held_events he ON he.id = m.held_event_id
          LEFT JOIN game_titles gt ON gt.id = m.game_title_id
          LEFT JOIN season_masters season ON season.id = m.season_master_id
          LEFT JOIN map_masters map ON map.id = m.map_master_id
          LEFT JOIN momo_login_accounts account ON account.id = m.note_updated_by_account_id
          WHERE m.id = $id
        """).query[Metadata].unique
          previous <- adjacent(value, previous = true, publicIds = publicIds)
          next <- adjacent(value, previous = false, publicIds = publicIds)
        yield MatchDetail(
          value,
          metadata.noteUpdatedByDisplayName,
          RecordNavigation(previous, next),
          Some(metadata.heldAt),
          metadata.labels,
          metadata.publicId,
          metadata.heldEventPublicId,
        )
      }
    yield detail

  private def adjacent(
      record: MatchRecord,
      previous: Boolean,
      publicIds: PostgresPublicIds,
  ): ConnectionIO[Option[AdjacentMatch]] =
    val comparison = if previous then fr"<" else fr">"
    val order = if previous then
      fr"""ORDER BY played_at DESC, held_event_id COLLATE "C" DESC,
                    match_no_in_event DESC, id COLLATE "C" DESC"""
    else
      fr"""ORDER BY played_at ASC, held_event_id COLLATE "C" ASC, match_no_in_event ASC, id COLLATE "C" ASC"""
    (fr"""
      SELECT m.id, m.held_event_id, m.played_at, he.start_at, m.match_no_in_event, m.public_id,
    """ ++ publicIds.column(fr"he.public_id") ++ fr"""
      FROM (
        SELECT id, held_event_id, played_at, match_no_in_event,
    """ ++ publicIds.column(fr"public_id") ++ fr""" AS public_id FROM matches
        WHERE (played_at, held_event_id COLLATE "C", match_no_in_event, id COLLATE "C")
    """ ++ comparison ++ fr"""
          (${record.playedAt}, ${record.heldEventId}, ${record.matchNoInEvent}, ${record.id})
    """ ++ order ++ fr"""LIMIT 1
      ) m JOIN held_events he ON he.id = m.held_event_id
    """).query[AdjacentMatch].option

  def identity(id: MatchId, publicIds: PostgresPublicIds): ConnectionIO[Option[MatchIdentity]] =
    (fr"""
    SELECT m.id, m.match_no_in_event, m.played_at, gt.name, season.name,
  """ ++ publicIds.column(fr"m.public_id") ++ fr"""
    FROM matches m
    LEFT JOIN game_titles gt ON gt.id = m.game_title_id
    LEFT JOIN season_masters season ON season.id = m.season_master_id
    WHERE m.id = $id
  """).query[MatchIdentity].option

final class PostgresMatchDetailReadModel[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    publicIds: PostgresPublicIds = PostgresPublicIds.Legacy,
) extends MatchDetailReadModel[F]:
  override def find(id: MatchId): F[Option[MatchDetail]] =
    PostgresMatchDetail.find(id, publicIds).transact(transactor)

  override def findByPublicId(publicId: PublicId): F[Option[MatchDetail]] =
    PostgresMatchDetail.findByPublicId(publicId, publicIds).transact(transactor)

  override def identity(id: MatchId): F[Option[MatchIdentity]] =
    PostgresMatchDetail.identity(id, publicIds).transact(transactor)
