package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMatchInsertOps.replaceMatchChildren
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisMutationOps.enqueueMatchMutation
import momo.api.domain.ids.*
import momo.api.domain.{AchievementMutationContext, MatchNoInEvent, MatchRecord, MatchUpdate}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MatchesAlg, MatchesRepository}

/**
 * Persists `matches` along with their dependent `match_players` (4 rows) and `match_incidents` (4 ×
 * 6 = 24 rows) atomically in a single connection. Updates merge omitted fields from the locked
 * parent; reads batch the player and incident rows.
 */
object PostgresMatches extends PostgresMatchesReadSupport:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  private def notFound[A](resource: String, id: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.NotFound(resource, id)))

  def alg(using ids: PostgresIdentities): MatchesAlg[ConnectionIO] =
    new MatchesAlg[ConnectionIO]:
      override def update(
          id: MatchId,
          change: MatchUpdate,
          updatedAt: Instant
      ): ConnectionIO[MatchRecord] =
        val current =
          (selectMatch ++ fr"WHERE id = ${ids.lookup(Entity.Matches, id.value)} FOR UPDATE").query[
            MatchRow
          ].option.flatMap {
            case Some(row) => toRecord(row, change.input.players).liftTo[ConnectionIO]
            case None => notFound[MatchRecord]("match", id.value)
          }
        def updateMatch(record: MatchRecord) =
          for
            heldEvent <- ids.requireReference(Entity.HeldEvents, record.heldEventId.value)
            heldEventLegacy <-
              sql"SELECT ${ids.wireReference(Entity.HeldEvents, heldEvent)}".query[String].unique
            title <- ids.requireReference(Entity.GameTitles, record.gameTitleId.value)
            season <- ids.requireReference(Entity.SeasonMasters, record.seasonMasterId.value)
            owner <- ids.requireReference(Entity.Members, record.ownerMemberId.value)
            map <- ids.requireReference(Entity.MapMasters, record.mapMasterId.value)
            assets <- ids.normalize(Entity.OcrDrafts, record.totalAssetsDraftId.map(_.value))
            revenue <- ids.normalize(Entity.OcrDrafts, record.revenueDraftId.map(_.value))
            incidents <-
              ids.normalize(Entity.OcrDrafts, record.incidentLogDraftId.map(_.value))
            affected <- sql"""
            UPDATE matches
            SET held_event_id = $heldEvent ${ids.legacySet("held_event_id", fr"$heldEventLegacy")},
                match_no_in_event = ${record.matchNoInEvent},
                game_title_id = $title, layout_family = ${record.layoutFamily},
                season_master_id = $season, owner_member_id = $owner, map_master_id = $map,
                played_at = ${record.playedAt}, total_assets_draft_id = $assets,
                revenue_draft_id = $revenue, incident_log_draft_id = $incidents,
                analysis_revision = analysis_revision + 1, updated_at = $updatedAt
            WHERE id = ${ids.lookup(Entity.Matches, record.id.value)}
          """.update.run
          yield affected

        (for
          lockedSources <-
            PostgresAchievementMatchLocks.lockMatches(List(id), List(change.input.heldEventId))
          previous <- current
          _ <- PostgresAchievementWriteOps.ensure(
            change.expectedVersion.forall(_ == previous.analysisRevision),
            "The match changed. Refresh before saving."
          )
          oldTitle = previous.gameTitleId
          record = change.applyTo(previous)
          events = (lockedSources.map(_.heldEventId) :+ record.heldEventId).distinct
          beforeTitles <- PostgresAchievementMatchLocks.affectedTitles(events)
          achievementItems <-
            PostgresAchievementWriteOps.lockForMatch(record.id, change.achievements)
          _ <- PostgresAchievementWriteOps.ensure(
            achievementItems.isEmpty || change.updatedByAccountId.nonEmpty,
            "An account is required to update achievement evidence."
          )
          achievementContext = AchievementMutationContext(
            change.updatedByAccountId.getOrElse(previous.createdByAccountId),
            updatedAt
          )
          previousRadarInput <- PostgresSeriesPlayerRadarMutationOps.inputIdentity(record.id)
          affected <- updateMatch(record)
          _ <- if affected == 1 then replaceMatchChildren(record)
          else notFound[Unit]("match", record.id.value)
          source = PostgresAchievementMatchLocks.MatchSource(
            record.id,
            record.heldEventId,
            record.gameTitleId,
            record.mapMasterId,
            record.playedAt,
            record.analysisRevision
          )
          _ <- PostgresAchievementWriteOps.followMatch(
            record.id,
            Some(source),
            achievementItems,
            achievementContext
          )
          declarationsChanged <- PostgresAchievementWriteOps.addDeclarations(
            source,
            change.achievements,
            achievementItems,
            achievementContext
          )
          afterTitles <- PostgresAchievementMatchLocks.affectedTitles(events)
          _ <-
            enqueueMatchMutation(beforeTitles ++ afterTitles ++ List(oldTitle, record.gameTitleId))
          currentRadarInput <- PostgresSeriesPlayerRadarMutationOps.inputIdentity(record.id)
          _ <- if previousRadarInput != currentRadarInput || declarationsChanged then
            PostgresSeriesPlayerRadarMutationOps.changed(
              beforeTitles ++ afterTitles ++ List(oldTitle, record.gameTitleId),
              Option.when(previousRadarInput.map(_.statistics) !=
                currentRadarInput.map(_.statistics))(
                PostgresSeriesPlayerRadarMutationOps.ChangedSourceMatch(
                  record.id,
                  List(oldTitle, record.gameTitleId)
                )
              )
            )
          else ().pure[ConnectionIO]
          saved <- find(
            record.id
          ).flatMap(_.liftTo[ConnectionIO](new IllegalStateException("updated match disappeared")))
        yield saved).exceptSomeSqlState {
          case state if isUniqueViolation(state) =>
            conflict[MatchRecord](s"matchNoInEvent ${change.input.matchNoInEvent.value
                .toString} already exists for held event ${change.input.heldEventId.value}.")
          case state if isForeignKeyViolation(state) =>
            conflict[MatchRecord]("Match prerequisites changed before the update completed.")
        }

      override def delete(id: MatchId, actor: Option[AccountId]): ConnectionIO[Boolean] =
        for
          sources <- PostgresAchievementMatchLocks.lockMatches(List(id))
          beforeTitles <- PostgresAchievementMatchLocks.affectedTitles(sources.map(_.heldEventId))
          previous <- sql"""
          SELECT ${ids.wireId("matches")}, ${ids.wireReference(
              Entity.GameTitles,
              fr"matches.game_title_id"
            )}
          FROM matches
          WHERE id = ${ids.lookup(Entity.Matches, id.value)}
          FOR UPDATE
        """.query[(MatchId, GameTitleId)].option
          achievementItems <- PostgresAchievementWriteOps.lockForMatch(id, Nil)
          _ <- PostgresAchievementWriteOps.ensure(
            achievementItems.isEmpty || actor.nonEmpty,
            "An account is required to unlink achievement evidence."
          )
          at <- sql"SELECT now()".query[Instant].unique
          _ <- actor.traverse_(account =>
            PostgresAchievementWriteOps.followMatch(
              id,
              None,
              achievementItems,
              AchievementMutationContext(account, at)
            )
          )
          _ <-
            sql"SELECT ${ids.wireId("match_drafts")} FROM match_drafts WHERE confirmed_match_id = ${ids.lookup(Entity.Matches, id.value)} ORDER BY ${ids.wireId("match_drafts")} FOR UPDATE"
              .query[MatchDraftId].to[List]
          deletedDrafts <-
            sql"DELETE FROM match_drafts WHERE confirmed_match_id = ${ids.lookup(Entity.Matches, id.value)} RETURNING ${ids.wireId("match_drafts")}"
              .query[MatchDraftId].to[List]
          deleted <-
            sql"DELETE FROM matches WHERE id = ${ids.lookup(Entity.Matches, id.value)}".update.run.map(
              _ > 0
            )
          _ <- previous.filter(_ => deleted).toList.traverse_((wireId, title) =>
            enqueueMatchMutation(beforeTitles :+ title) *>
              PostgresSeriesPlayerRadarMutationOps.changed(
                beforeTitles :+ title,
                Some(PostgresSeriesPlayerRadarMutationOps.ChangedSourceMatch(wireId, List(title)))
              )
          )
          _ <- PostgresResultNotificationCancellation.afterDeletion(
            deletedDrafts,
            previous.map(_._1).toList.filter(_ => deleted)
          )
        yield deleted

      override def find(id: MatchId): ConnectionIO[Option[MatchRecord]] =
        (selectMatch ++ fr"WHERE id = ${ids.lookup(Entity.Matches, id.value)}").query[
          MatchRow
        ].option.flatMap {
          case None => Option.empty[MatchRecord].pure[ConnectionIO]
          case Some(row) => loadPlayersBatch(List(row.id))
              .flatMap(byMid =>
                byMid.get(row.id).traverse(p => toRecord(row, p).liftTo[ConnectionIO])
              )
        }

      override def existsMatchNo(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
      ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = ${ids.lookup(
          Entity.HeldEvents,
          heldEventId.value
        )} AND match_no_in_event = $matchNoInEvent
        )
      """.query[Boolean].unique

      override def existsMatchNoExcept(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
          excludeMatchId: MatchId,
      ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = ${ids.lookup(Entity.HeldEvents, heldEventId.value)}
            AND match_no_in_event = $matchNoInEvent
            AND id <> ${ids.lookup(Entity.Matches, excludeMatchId.value)}
        )
      """.query[Boolean].unique

end PostgresMatches

final class PostgresMatchesRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy
) extends MatchesRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: MatchesRepository[F] = MatchesRepository
    .fromAlg(PostgresMatches.alg, transactor.trans)

  export delegate.{update, delete, existsMatchNo, existsMatchNoExcept}

  override def find(id: MatchId): F[Option[MatchRecord]] =
    readSnapshot(PostgresMatches.alg.find(id))

  private def readSnapshot[A](read: ConnectionIO[A]): F[A] =
    (sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run *> read)
      .transact(transactor)
end PostgresMatchesRepository
