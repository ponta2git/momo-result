package momo.api.adapters.postgres

import java.time.{LocalDate, ZoneId}

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{HeldEventId, MatchDraftId}
import momo.api.domain.{HeldEvent, PublicId}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  HeldEventDeletionAlg,
  HeldEventDeletionRepository,
  HeldEventDeletionResult,
  HeldEventsAlg,
  HeldEventsRepository
}

/**
 * `held_events` の純粋 [[HeldEventsAlg]] と、それを `Transactor[F]` で持ち上げた facade。
 *
 * 本アプリで作成する ad-hoc な開催履歴は `session_id IS NULL` で挿入する。`held_date_iso` は表示用日付として `start_at` を
 * Asia/Tokyo に変換した `LocalDate` で埋める。`heldAt` だけが Scala 側のドメインで保持される。
 */
object PostgresHeldEvents:

  private val Jst = ZoneId.of("Asia/Tokyo")
  private final case class HeldEventRow(
      id: HeldEventId,
      heldAt: java.time.Instant,
      publicId: Option[PublicId]
  )

  private def fromRow(row: HeldEventRow): HeldEvent = HeldEvent(row.id, row.heldAt, row.publicId)

  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  def alg(using identities: PostgresIdentities): HeldEventsAlg[ConnectionIO] =
    withPublicIds(PostgresPublicIds.Legacy)

  def withPublicIds(publicIds: PostgresPublicIds)(using
      ids: PostgresIdentities): HeldEventsAlg[ConnectionIO] =
    new HeldEventsAlg[ConnectionIO]:
      override def find(id: HeldEventId): ConnectionIO[Option[HeldEvent]] =
        (fr"SELECT ${ids.wireId("held_events")}, start_at," ++ publicIds.column(fr"public_id") ++
          fr"FROM held_events WHERE id = ${ids.lookup(Entity.HeldEvents, id.value)}").query[
          HeldEventRow
        ].option.map(_.map(fromRow))

      override def create(event: HeldEvent): ConnectionIO[Unit] =
        val heldDateIso: LocalDate = event.heldAt.atZone(Jst).toLocalDate
        ids.newId(event.id.value).flatMap { newId =>
          sql"""
        INSERT INTO held_events (${ids.idColumns}, session_id, held_date_iso, start_at, created_at)
        VALUES ($newId, NULL, $heldDateIso, ${event.heldAt}, ${event.heldAt})
      """.update.run.void
        }.exceptSomeSqlState {
          case state if isUniqueViolation(state) =>
            conflict(s"held event already exists: ${event.id.value}")
        }

end PostgresHeldEvents

object PostgresHeldEventDeletion:
  private def isForeignKeyViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.FOREIGN_KEY_VIOLATION.value

  private final case class DeletionState(
      found: Boolean,
      hasMatches: Boolean,
      hasDrafts: Boolean,
      deleted: Boolean,
  )

  private def deleteDiscardedForEvent(id: HeldEventId)(using
      ids: PostgresIdentities): ConnectionIO[List[MatchDraftId]] =
    deleteDiscardedDrafts(fr"held_event_id = ${ids.lookup(Entity.HeldEvents, id.value)}")

  def alg(using ids: PostgresIdentities): HeldEventDeletionAlg[ConnectionIO] =
    new HeldEventDeletionAlg[ConnectionIO]:
      override def deleteIfUnreferenced(id: HeldEventId): ConnectionIO[HeldEventDeletionResult] =
        deleteDiscardedForEvent(id).flatMap { deletedDrafts =>
          sql"""
        WITH target AS (
          SELECT id FROM held_events WHERE id = ${ids.lookup(Entity.HeldEvents, id.value)}
        ),
        reference_state AS (
          SELECT
            EXISTS(SELECT 1 FROM matches WHERE held_event_id = ${ids.lookup(
              Entity.HeldEvents,
              id.value
            )}) AS has_matches,
            EXISTS(SELECT 1 FROM match_drafts WHERE held_event_id = ${ids.lookup(
              Entity.HeldEvents,
              id.value
            )}) AS has_drafts
        ),
        deleted AS (
          DELETE FROM held_events
          WHERE id = ${ids.lookup(Entity.HeldEvents, id.value)}
            AND EXISTS (SELECT 1 FROM target)
            AND NOT EXISTS (SELECT 1 FROM matches WHERE held_event_id = ${ids.lookup(
              Entity.HeldEvents,
              id.value
            )})
            AND NOT EXISTS (SELECT 1 FROM match_drafts WHERE held_event_id = ${ids.lookup(
              Entity.HeldEvents,
              id.value
            )})
          RETURNING id
        )
        SELECT
          EXISTS(SELECT 1 FROM target) AS found,
          (SELECT has_matches FROM reference_state) AS has_matches,
          (SELECT has_drafts FROM reference_state) AS has_drafts,
          EXISTS(SELECT 1 FROM deleted) AS deleted
      """.query[DeletionState].unique.map {
            case state if state.deleted => HeldEventDeletionResult.Deleted
            case state if !state.found => HeldEventDeletionResult.NotFound
            case state if state.hasMatches => HeldEventDeletionResult.HasConfirmedMatches
            case state if state.hasDrafts => HeldEventDeletionResult.HasMatchDrafts
            case _ => HeldEventDeletionResult.Referenced
          }.flatTap(_ => PostgresResultNotificationCancellation.afterDeletion(deletedDrafts, Nil))
        }.exceptSomeSqlState {
          case state if isForeignKeyViolation(state) =>
            MonadThrow[ConnectionIO].pure(HeldEventDeletionResult.Referenced)
        }
end PostgresHeldEventDeletion

final class PostgresHeldEventsRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    publicIds: PostgresPublicIds = PostgresPublicIds.Legacy,
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends HeldEventsRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: HeldEventsRepository[F] = HeldEventsRepository
    .fromAlg(PostgresHeldEvents.withPublicIds(publicIds), transactor.trans)

  export delegate.*
end PostgresHeldEventsRepository

final class PostgresHeldEventDeletionRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy
) extends HeldEventDeletionRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: HeldEventDeletionRepository[F] = HeldEventDeletionRepository
    .fromAlg(PostgresHeldEventDeletion.alg, transactor.trans)

  export delegate.*
end PostgresHeldEventDeletionRepository
