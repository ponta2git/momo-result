package momo.api.adapters

import cats.syntax.flatMap.*
import cats.syntax.functor.*
import cats.Monad
import java.time.Instant
import momo.api.domain.MatchRecord
import momo.api.repositories.{MatchConfirmationRepository, MatchDraftsRepository, MatchesRepository}

final class InMemoryMatchConfirmationRepository[F[_]: Monad](
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
) extends MatchConfirmationRepository[F]:
  override def confirm(
      record: MatchRecord,
      draftId: Option[String],
      updatedAt: Instant,
  ): F[Boolean] = draftId match
    case None => matches.create(record).as(true)
    case Some(id) =>
      for
        _ <- matches.create(record)
        updated <- matchDrafts.markConfirmed(id, record.id, updatedAt)
      yield updated
