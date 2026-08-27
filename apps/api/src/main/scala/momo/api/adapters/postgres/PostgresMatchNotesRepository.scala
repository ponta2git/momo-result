package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.ids.{AccountId, MatchId}
import momo.api.domain.{MatchNote, MatchNoteBody, MatchNoteVersion}
import momo.api.repositories.{MatchNotesRepository, ReplaceMatchNoteResult}

object PostgresMatchNotes:
  private final case class StoredNote(
      body: Option[String],
      version: Long,
      updatedBy: Option[AccountId],
      updatedAt: Option[Instant],
  )

  def replace(
      matchId: MatchId,
      expectedVersion: MatchNoteVersion,
      body: Option[MatchNoteBody],
      updatedBy: AccountId,
      updatedAt: Instant,
  ): ConnectionIO[ReplaceMatchNoteResult] =
    val load = sql"""
      SELECT note_body, note_version, note_updated_by_account_id, note_updated_at
      FROM matches
      WHERE id = $matchId
      FOR UPDATE
    """.query[StoredNote].option

    load.flatMap {
      case None => ReplaceMatchNoteResult.NotFound.pure[ConnectionIO]
      case Some(row) =>
        decode(row).flatMap { current =>
          if current.version != expectedVersion then
            ReplaceMatchNoteResult.VersionConflict.pure[ConnectionIO]
          else if current.body == body then
            ReplaceMatchNoteResult.Unchanged(current).pure[ConnectionIO]
          else
            val next = MatchNote(body, expectedVersion.next, Some(updatedBy), Some(updatedAt))
            sql"""
              UPDATE matches
              SET note_body = ${body.map(_.value)},
                  note_version = ${next.version.value},
                  note_updated_by_account_id = $updatedBy,
                  note_updated_at = $updatedAt
              WHERE id = $matchId
            """.update.run.as(ReplaceMatchNoteResult.Updated(next))
        }
    }

  private def decode(row: StoredNote): ConnectionIO[MatchNote] =
    val decoded = for
      body <- row.body.traverse(MatchNoteBody.fromRequiredString)
      version <- MatchNoteVersion.fromLong(row.version)
      note <- MatchNote.persisted(body, version, row.updatedBy, row.updatedAt)
    yield note
    decoded.leftMap(message => PostgresDataIntegrityException
      .inconsistentRow("matches", "note", message)).liftTo[ConnectionIO]

final class PostgresMatchNotesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchNotesRepository[F]:
  def replace(
      matchId: MatchId,
      expectedVersion: MatchNoteVersion,
      body: Option[MatchNoteBody],
      updatedBy: AccountId,
      updatedAt: Instant,
  ): F[ReplaceMatchNoteResult] = Database.transactK(transactor)(
    PostgresMatchNotes.replace(matchId, expectedVersion, body, updatedBy, updatedAt)
  )
