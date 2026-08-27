package momo.api.usecases.matches

import java.time.Instant

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.{AccountId, MatchId}
import momo.api.domain.{MatchNote, MatchNoteBody, MatchNoteVersion}
import momo.api.errors.AppError
import momo.api.repositories.{MatchNotesRepository, ReplaceMatchNoteResult}

final case class ReplaceMatchNoteCommand(
    body: Option[MatchNoteBody],
    expectedVersion: MatchNoteVersion,
)

final class ReplaceMatchNote[F[_]: Monad](notes: MatchNotesRepository[F], now: F[Instant]):
  def run(
      matchId: MatchId,
      command: ReplaceMatchNoteCommand,
      accountId: AccountId,
  ): F[Either[AppError, MatchNote]] = now.flatMap { timestamp =>
    notes.replace(matchId, command.expectedVersion, command.body, accountId, timestamp).map {
      case ReplaceMatchNoteResult.Updated(note) => Right(note)
      case ReplaceMatchNoteResult.Unchanged(note) => Right(note)
      case ReplaceMatchNoteResult.VersionConflict => Left(AppError.MatchNoteVersionConflict())
      case ReplaceMatchNoteResult.NotFound => Left(AppError.NotFound("match", matchId.value))
    }
  }
