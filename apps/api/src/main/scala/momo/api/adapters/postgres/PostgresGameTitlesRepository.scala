package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.*

object PostgresGameTitles:
  private final case class GameTitleRow(
      id: GameTitleId,
      name: String,
      layoutFamily: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private final case class AnalysisRelease(
      algorithmVersion: String,
      artifactSchemaVersion: Int,
      validationContractId: Option[String],
  )

  private def fromRow(row: GameTitleRow): GameTitle = GameTitle(
    id = row.id,
    name = row.name,
    layoutFamily = row.layoutFamily,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  def alg(using ids: PostgresIdentities): GameTitlesAlg[ConnectionIO] =
    new GameTitlesAlg[ConnectionIO]:
      override def list: ConnectionIO[List[GameTitle]] =
        val nameLimit = PostgresReadBudget.NameCodePoints
        val keyLimit = PostgresReadBudget.KeyCodePoints
        PostgresReadBudget.guardedRows[GameTitleRow](
          sql"""
        SELECT char_length(name) <= $nameLimit AND char_length(layout_family) <= $keyLimit,
               ${ids.wireId(
              "game_titles"
            )}, LEFT(name, $nameLimit), LEFT(layout_family, $keyLimit), display_order, created_at
        FROM game_titles ORDER BY display_order, created_at, ${ids.wireId("game_titles")}
      """,
          PostgresReadBudget.CatalogRows,
          "Game-title catalog"
        ).map(_.map(fromRow))

      override def find(id: GameTitleId): ConnectionIO[Option[GameTitle]] =
        val nameLimit = PostgresReadBudget.NameCodePoints
        val keyLimit = PostgresReadBudget.KeyCodePoints
        PostgresReadBudget.guardedRows[GameTitleRow](
          fr"""SELECT char_length(name) <= $nameLimit AND char_length(layout_family) <= $keyLimit,
          ${ids.wireId("game_titles")}, LEFT(name, $nameLimit), LEFT(layout_family, $keyLimit), display_order, created_at FROM game_titles WHERE id = ${ids.lookup(
              Entity.GameTitles,
              id.value
            )}""",
          1,
          "Game-title detail",
        ).map(_.headOption.map(fromRow))

      override def createWithNextDisplayOrder(title: GameTitle): ConnectionIO[GameTitle] =
        val lockKey = "momo:game_titles:display_order"
        // The allocation needs a new READ COMMITTED snapshot after any lock wait.
        (for
          newId <- ids.newId(title.id.value)
          _ <- sql"SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)".query[Unit].unique
          // Serialize creation with release promotion before either the title or its state exists.
          release <- sql"""
          SELECT algorithm_version, artifact_schema_version, validation_contract_id
          FROM series_analysis_release_state WHERE singleton_key = 'current' FOR SHARE
        """.query[AnalysisRelease].unique
          row <- sql"""
        INSERT INTO game_titles (${ids.idColumns}, name, layout_family, display_order, created_at)
        SELECT $newId, ${title.name}, ${title.layoutFamily}, COALESCE(MAX(display_order), 0) + 1, ${title
              .createdAt}
        FROM game_titles
        RETURNING ${ids.wireId("game_titles")}, name, layout_family, display_order, created_at
      """.query[GameTitleRow].unique
          // Only this creation transaction can prove there was no earlier analysis input.
          // The conflict branch supports the old creation trigger without changing its tuple.
          _ <- sql"""
          INSERT INTO series_analysis_title_states
            (game_title_id, algorithm_version, artifact_schema_version,
             validation_contract_id, notification_baseline_state)
          VALUES (${ids.lookup(
              Entity.GameTitles,
              row.id.value
            )}, ${release.algorithmVersion}, ${release.artifactSchemaVersion},
            ${release.validationContractId}, 'initial')
          ON CONFLICT (game_title_id) DO UPDATE SET notification_baseline_state = 'initial'
          WHERE series_analysis_title_states.algorithm_version = EXCLUDED.algorithm_version
            AND series_analysis_title_states.artifact_schema_version = EXCLUDED.artifact_schema_version
            AND series_analysis_title_states.validation_contract_id
              IS NOT DISTINCT FROM EXCLUDED.validation_contract_id
        """.update.run.flatMap {
            case 1 => ().pure[ConnectionIO]
            case _ =>
              new IllegalStateException("new game title analysis state does not match release")
                .raiseError[ConnectionIO, Unit]
          }
        yield fromRow(row)).exceptSomeSqlState {
          case state if isUniqueViolation(state) =>
            conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
        }

      override def update(title: GameTitle): ConnectionIO[Unit] = sql"""
        UPDATE game_titles
        SET name = ${title.name}, layout_family = ${title.layoutFamily}
        WHERE id = ${ids.lookup(Entity.GameTitles, title.id.value)}
      """.update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("game title", title.id.value)
      }.exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
      }

      override def delete(id: GameTitleId): ConnectionIO[Unit] = (for
        _ <- prepareAnalysisDeletion(id)
        deletedDrafts <-
          deleteDiscardedDrafts(fr"game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}")
        deleted <-
          sql"DELETE FROM game_titles WHERE id = ${ids.lookup(Entity.GameTitles, id.value)}".update.run
        _ <- deleted match
          case 1 => ().pure[ConnectionIO]
          case _ => notFound("game title", id.value)
        _ <- PostgresResultNotificationCancellation.afterDeletion(deletedDrafts, Nil)
      yield ()).exceptSomeSqlState {
        case state if isForeignKeyViolation(state) => conflict("game title is still referenced.")
      }

  private def prepareAnalysisDeletion(id: GameTitleId)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    for
      now <- sql"SELECT now()".query[Instant].unique
      _ <- sql"""
        SELECT ${ids.wireReference(Entity.GameTitles, fr"game_title_id")}
        FROM series_analysis_title_states
        WHERE game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}
        FOR UPDATE
      """.query[GameTitleId].option
      // A match writer can already own the title's FK KEY SHARE while waiting for the
      // analysis state above. Never wait for that writer while holding its next lock.
      _ <-
        sql"SELECT ${ids.wireId("game_titles")} FROM game_titles WHERE id = ${ids.lookup(Entity.GameTitles, id.value)} FOR UPDATE NOWAIT"
          .query[GameTitleId].option
      _ <- sql"""
        SELECT ${ids.wireId("series_analysis_jobs")}
        FROM series_analysis_jobs
        WHERE game_title_id = ${ids.lookup(
          Entity.GameTitles,
          id.value
        )} AND status IN ('queued', 'running')
        FOR UPDATE
      """.query[String].to[List]
      _ <- sql"""
        UPDATE series_analysis_job_requests
        SET status = 'fulfilled', fulfilled_at = COALESCE(fulfilled_at, $now)
        WHERE game_title_id = ${ids.lookup(Entity.GameTitles, id.value)} AND status <> 'fulfilled'
      """.update.run
      affectedCampaigns <- sql"""
        UPDATE series_analysis_campaign_targets
        SET status = 'skipped_title_deleted', updated_at = $now
        WHERE game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}
          AND status NOT IN ('succeeded', 'failed', 'skipped_title_deleted')
        RETURNING ${ids.wireReference(Entity.AnalysisCampaigns, fr"campaign_id")}
      """.query[String].to[List]
      _ <- affectedCampaigns.distinct.sorted.traverse_(campaignId =>
        PostgresSeriesAnalysisCampaignStatusOps.refresh(campaignId, now)
      )
      _ <- sql"""
        UPDATE series_analysis_operation_requests o
        SET status = 'terminal', finished_at = COALESCE(o.finished_at, $now)
        WHERE o.scope = 'title'
          AND o.game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}
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
            notification_baseline_state = 'unknown',
            notification_baseline_artifact_id = NULL,
            pending_work = false,
            updated_at = $now
        WHERE game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}
      """.update.run
    yield ()

end PostgresGameTitles

final class PostgresGameTitlesRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends GameTitlesRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: GameTitlesRepository[F] = GameTitlesRepository
    .fromAlg(PostgresGameTitles.alg, transactor.trans)

  export delegate.{list, find, createWithNextDisplayOrder, update}

  override def delete(id: GameTitleId): F[Either[AppError, Unit]] =
    // Translate contention only after transact has rolled back and released the title state.
    RepositoryResult.capture(
      PostgresGameTitles.alg.delete(id).transact(transactor).exceptSomeSqlState {
        case state if state.value == "55P03" =>
          new AppException(AppError.Conflict(
            "The game title is being changed. Retry the deletion."
          )).raiseError[F, Unit]
      }
    )
end PostgresGameTitlesRepository
