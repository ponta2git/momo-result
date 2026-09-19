package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.MatchId
import momo.api.domain.{MatchDetail, MatchIdentity, MatchLabels}
import momo.api.repositories.MatchDetailReadModel

object PostgresMatchDetail:
  private final case class Metadata(
      heldAt: Instant,
      labels: MatchLabels,
      noteUpdatedByDisplayName: Option[String],
  )

  def find(id: MatchId): ConnectionIO[Option[MatchDetail]] =
    for
      _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
      record <- PostgresMatches.alg.find(id)
      detail <- record.traverse { value =>
        sql"""
          SELECT he.start_at, gt.name, season.name, map.name, account.display_name
          FROM matches m
          JOIN held_events he ON he.id = m.held_event_id
          LEFT JOIN game_titles gt ON gt.id = m.game_title_id
          LEFT JOIN season_masters season ON season.id = m.season_master_id
          LEFT JOIN map_masters map ON map.id = m.map_master_id
          LEFT JOIN momo_login_accounts account ON account.id = m.note_updated_by_account_id
          WHERE m.id = $id
        """.query[Metadata].unique.map(metadata =>
          MatchDetail(value, metadata.noteUpdatedByDisplayName, Some(metadata.heldAt), metadata.labels)
        )
      }
    yield detail

  def identity(id: MatchId): ConnectionIO[Option[MatchIdentity]] = sql"""
    SELECT m.id, m.match_no_in_event, m.played_at, gt.name, season.name
    FROM matches m
    LEFT JOIN game_titles gt ON gt.id = m.game_title_id
    LEFT JOIN season_masters season ON season.id = m.season_master_id
    WHERE m.id = $id
  """.query[MatchIdentity].option

final class PostgresMatchDetailReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDetailReadModel[F]:
  override def find(id: MatchId): F[Option[MatchDetail]] = PostgresMatchDetail.find(id).transact(transactor)
  override def identity(id: MatchId): F[Option[MatchIdentity]] = PostgresMatchDetail.identity(id).transact(transactor)
