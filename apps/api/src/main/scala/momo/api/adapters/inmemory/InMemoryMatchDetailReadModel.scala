package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.MatchId
import momo.api.domain.{MatchDetail, MatchIdentity}
import momo.api.repositories.{LoginAccountsRepository, MatchDetailReadModel, MatchesRepository}

final class InMemoryMatchDetailReadModel[F[_]: Monad](
    matches: MatchesRepository[F],
    accounts: LoginAccountsRepository[F],
    metadata: InMemoryMatchMetadata[F],
) extends MatchDetailReadModel[F]:
  override def find(id: MatchId): F[Option[MatchDetail]] = matches.find(id).flatMap(_.traverse { record =>
    for
      account <- record.note.updatedByAccountId.traverse(accounts.find)
      heldAt <- metadata.heldAt(Some(record.heldEventId))
      labels <- metadata.labels(Some(record.gameTitleId), Some(record.seasonMasterId), Some(record.mapMasterId))
    yield MatchDetail(record, account.flatten.map(_.displayName), heldAt, labels)
  })

  override def identity(id: MatchId): F[Option[MatchIdentity]] = matches.find(id).flatMap(_.traverse { record =>
    metadata.labels(Some(record.gameTitleId), Some(record.seasonMasterId), None)
      .map(labels => MatchIdentity(record.id, record.matchNoInEvent, record.playedAt, labels.gameTitleName, labels.seasonName))
  })
