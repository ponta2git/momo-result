package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import cats.syntax.apply.*
import cats.syntax.functor.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate
import doobie.util.fragments

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMatchInsertOps.insertMatchCascade
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisMutationOps.enqueueMatchMutation
import momo.api.domain.ids.*
import momo.api.domain.{
  AchievementMutationContext,
  AddMatchAchievement,
  MatchDraftConfirmability,
  MatchDraftStatus,
  MatchRecord
}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  MatchConfirmationRepository,
  MatchConfirmationResult,
  MatchDraftConfirmation,
  RepositoryResult
}

final class PostgresMatchConfirmationRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy
) extends MatchConfirmationRepository[F]:
  private given ids: PostgresIdentities = identities
  private final case class ConfirmedDraftSourceImagesRow(
      totalAssetsImageId: Option[ImageId],
      revenueImageId: Option[ImageId],
      incidentLogImageId: Option[ImageId],
  ):
    def imageIds: List[ImageId] =
      List(totalAssetsImageId, revenueImageId, incidentLogImageId).flatten

  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  override def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
      achievements: List[AddMatchAchievement],
  ): F[Either[AppError, MatchConfirmationResult]] =
    val program = draft match
      case None => insert(record, updatedAt, achievements).as(MatchConfirmationResult.Confirmed)
      case Some(expected) =>
        for
          updatedImages <-
          (fr"""
            UPDATE match_drafts SET
              status = ${MatchDraftStatus.Confirmed},
              source_images_retained_until = $updatedAt,
              source_images_deleted_at = $updatedAt,
              updated_at = $updatedAt
            WHERE id = ${ids.lookup(Entity.MatchDrafts, expected.draftId.value)}
              AND updated_at = ${expected.updatedAt}
              AND ${ids.retainedColumn(
              "match_drafts",
              "total_assets_draft_id"
            )} IS NOT DISTINCT FROM ${expected.totalAssetsDraftId}
              AND ${ids.retainedColumn(
              "match_drafts",
              "revenue_draft_id"
            )} IS NOT DISTINCT FROM ${expected.revenueDraftId}
              AND ${ids.retainedColumn(
              "match_drafts",
              "incident_log_draft_id"
            )} IS NOT DISTINCT FROM ${expected.incidentLogDraftId}
              AND """ ++ fragments.in(fr"status", MatchDraftConfirmability.statuses) ++ fr"""
            RETURNING total_assets_image_id, revenue_image_id, incident_log_image_id
          """).query[ConfirmedDraftSourceImagesRow].option
          _ <- updatedImages match
            case Some(images) =>
              PostgresOcrSubmissions.abortForDrafts(List(expected.draftId), updatedAt) *>
                PostgresSourceImageLifecycle.stageDeletion(images.imageIds, updatedAt) *>
                insert(record, updatedAt, achievements) *> attachConfirmedMatch(expected, record) *>
                PostgresResultNotificationCancellation.draftsUnavailable(
                  List(expected.draftId),
                  updatedAt
                )
            case None => ().pure[ConnectionIO]
        yield
          if updatedImages.nonEmpty then MatchConfirmationResult.Confirmed
          else MatchConfirmationResult.DraftSnapshotMismatch
    RepositoryResult.capture((PostgresAchievementMatchLocks.lockEvents(List(record.heldEventId)) *>
      program).transact(transactor))

  private def insert(
      record: MatchRecord,
      updatedAt: Instant,
      achievements: List[AddMatchAchievement]
  ): ConnectionIO[Unit] =
    (for
      before <- PostgresAchievementMatchLocks.affectedTitles(List(record.heldEventId))
      _ <- insertMatchCascade(record, updatedAt)
      items <- PostgresAchievementWriteOps.lockForMatch(record.id, achievements)
      _ <- PostgresAchievementWriteOps.addDeclarations(
        PostgresAchievementMatchLocks.MatchSource(
          record.id,
          record.heldEventId,
          record.gameTitleId,
          record.mapMasterId,
          record.playedAt,
          record.analysisRevision
        ),
        achievements,
        items,
        AchievementMutationContext(record.createdByAccountId, updatedAt)
      )
      _ <- enqueueMatchMutation(before :+ record.gameTitleId)
      _ <- PostgresSeriesPlayerRadarMutationOps.changed(List(record.gameTitleId), record.id, false)
      _ <- PostgresSeriesPlayerRadarMutationOps.achievementsChanged(before :+ record.gameTitleId)
    yield ())
      .exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
              .toString} already exists for held event ${record.heldEventId.value}.")
        case state if isForeignKeyViolation(state) =>
          conflict[Unit]("Match prerequisites changed before confirmation completed.")
      }

  private def attachConfirmedMatch(
      expected: MatchDraftConfirmation,
      record: MatchRecord,
  ): ConnectionIO[Unit] = sql"""
      UPDATE match_drafts SET confirmed_match_id = ${ids.lookup(Entity.Matches, record.id.value)}
      WHERE id = ${ids.lookup(Entity.MatchDrafts, expected.draftId.value)}
    """.update.run.flatMap {
    case 1 => ().pure[ConnectionIO]
    case affected => MonadThrow[ConnectionIO]
        .raiseError[Unit](PostgresDataIntegrityException.inconsistentRow(
          "match_drafts",
          expected.draftId.value,
          s"expected to attach confirmed match ${record.id.value}, but updated $affected rows",
        ))
  }
