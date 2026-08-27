package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.{AccountId, MatchId}
import momo.api.domain.{MatchNote, MatchNoteBody, MatchNoteVersion}

enum ReplaceMatchNoteResult derives CanEqual:
  case Updated(note: MatchNote)
  case Unchanged(note: MatchNote)
  case VersionConflict
  case NotFound

trait MatchNotesRepository[F[_]]:
  def replace(
      matchId: MatchId,
      expectedVersion: MatchNoteVersion,
      body: Option[MatchNoteBody],
      updatedBy: AccountId,
      updatedAt: Instant,
  ): F[ReplaceMatchNoteResult]
