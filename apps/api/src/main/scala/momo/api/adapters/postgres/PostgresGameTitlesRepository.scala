package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

object PostgresGameTitles:
  private final case class GameTitleRow(
      id: GameTitleId,
      name: String,
      layoutFamily: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private val selectAll =
    fr"SELECT id, name, layout_family, display_order, created_at FROM game_titles"

  private def fromRow(row: GameTitleRow): GameTitle = GameTitle(
    id = row.id,
    name = row.name,
    layoutFamily = row.layoutFamily,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  val alg: GameTitlesAlg[ConnectionIO] = new GameTitlesAlg[ConnectionIO]:
    override def list: ConnectionIO[List[GameTitle]] =
      (selectAll ++ fr"ORDER BY display_order, created_at, id").query[GameTitleRow].to[List]
        .map(_.map(fromRow))

    override def find(id: GameTitleId): ConnectionIO[Option[GameTitle]] =
      (selectAll ++ fr"WHERE id = $id").query[GameTitleRow].option.map(_.map(fromRow))

    override def createWithNextDisplayOrder(title: GameTitle): ConnectionIO[GameTitle] =
      val lockKey = "momo:game_titles:display_order"
      sql"""
        WITH display_order_lock AS (
          SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)
        ),
        next_order AS (
          SELECT COALESCE(MAX(display_order), 0) + 1 AS display_order
          FROM game_titles
        )
        INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
        SELECT ${title.id}, ${title.name}, ${title.layoutFamily}, next_order.display_order, ${title
          .createdAt}
        FROM display_order_lock, next_order
        RETURNING id, name, layout_family, display_order, created_at
      """.query[GameTitleRow].unique.map(fromRow).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
      }

    override def update(title: GameTitle): ConnectionIO[Unit] = sql"""
        UPDATE game_titles
        SET name = ${title.name}, layout_family = ${title.layoutFamily}
        WHERE id = ${title.id}
      """.update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("game title", title.id.value)
    }.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
    }

    override def delete(id: GameTitleId): ConnectionIO[Unit] = (for
      _ <- prepareAnalysisDeletion(id)
      _ <- deleteDiscardedDrafts(fr"game_title_id = $id")
      deleted <- sql"DELETE FROM game_titles WHERE id = $id".update.run
      _ <- deleted match
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("game title", id.value)
    yield ()).exceptSomeSqlState {
      case state if isForeignKeyViolation(state) => conflict("game title is still referenced.")
    }

  private def prepareAnalysisDeletion(id: GameTitleId): ConnectionIO[Unit] =
    for
      now <- sql"SELECT now()".query[Instant].unique
      _ <- sql"""
        SELECT game_title_id
        FROM series_analysis_title_states
        WHERE game_title_id = $id
        FOR UPDATE
      """.query[GameTitleId].option
      _ <- sql"""
        SELECT id
        FROM series_analysis_jobs
        WHERE game_title_id = $id AND status IN ('queued', 'running')
        FOR UPDATE
      """.query[String].to[List]
      _ <- sql"""
        UPDATE series_analysis_job_requests
        SET status = 'fulfilled', fulfilled_at = COALESCE(fulfilled_at, $now)
        WHERE game_title_id = $id AND status <> 'fulfilled'
      """.update.run
      affectedCampaigns <- sql"""
        UPDATE series_analysis_campaign_targets
        SET status = 'skipped_title_deleted', updated_at = $now
        WHERE game_title_id = $id
          AND status NOT IN ('succeeded', 'failed', 'skipped_title_deleted')
        RETURNING campaign_id
      """.query[String].to[List]
      _ <- affectedCampaigns.distinct.traverse_(campaignId =>
        PostgresSeriesAnalysisCampaignExpansionOps.refreshCampaign(campaignId, now)
      )
      _ <- sql"""
        UPDATE series_analysis_operation_requests o
        SET status = 'terminal', finished_at = COALESCE(o.finished_at, $now)
        WHERE o.scope = 'title'
          AND o.game_title_id = $id
          AND o.status <> 'terminal'
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_job_requests r
            WHERE r.operation_request_id = o.id AND r.status <> 'fulfilled'
          )
      """.update.run
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET current_artifact_id = NULL,
            previous_artifact_id = NULL,
            pending_work = false,
            pending_forced_run_count = 0,
            updated_at = $now
        WHERE game_title_id = $id
      """.update.run
    yield ()

end PostgresGameTitles

final class PostgresGameTitlesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends GameTitlesRepository[F]:
  private val delegate: GameTitlesRepository[F] = GameTitlesRepository
    .fromAlg(PostgresGameTitles.alg, transactor.trans)

  export delegate.*
end PostgresGameTitlesRepository
