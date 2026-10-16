package momo.api.adapters.inmemory

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.ids.MatchId
import momo.api.domain.{
  AdjacentMatch,
  MatchDetail,
  MatchIdentity,
  MatchRecord,
  RecordNavigation,
  RecordNavigationOrder
}
import momo.api.repositories.{LoginAccountsRepository, MatchDetailReadModel, MatchesRepository}

final class InMemoryMatchDetailReadModel[F[_]: MonadThrow](
    matches: MatchesRepository[F],
    accounts: LoginAccountsRepository[F],
    metadata: InMemoryMatchMetadata[F],
) extends MatchDetailReadModel[F]:
  override def find(id: MatchId): F[Option[MatchDetail]] =
    matches.list(MatchesRepository.ListFilter()).map(records =>
      RecordNavigation.select(records.sorted(using RecordNavigationOrder.matches))(_.id == id)
    ).flatMap(_.traverse { case (record, navigation) =>
      for
        account <- record.note.updatedByAccountId.traverse(accounts.find)
        heldAt <- metadata.heldAt(Some(record.heldEventId))
        labels <- metadata.labels(
          Some(record.gameTitleId),
          Some(record.seasonMasterId),
          Some(record.mapMasterId)
        )
        previous <- navigation.previous.traverse(adjacent)
        next <- navigation.next.traverse(adjacent)
      yield MatchDetail(
        record,
        account.flatten.map(_.displayName),
        RecordNavigation(previous, next),
        heldAt,
        labels
      )
    })

  private def adjacent(record: MatchRecord): F[AdjacentMatch] =
    metadata.heldAt(Some(record.heldEventId)).flatMap(_.toRight(
      new IllegalStateException("Adjacent match references a missing held event")
    ).liftTo[F]).map(heldAt =>
      AdjacentMatch(record.id, record.heldEventId, record.playedAt, heldAt, record.matchNoInEvent)
    )

  override def identity(id: MatchId): F[Option[MatchIdentity]] =
    matches.find(id).flatMap(_.traverse { record =>
      metadata.labels(Some(record.gameTitleId), Some(record.seasonMasterId), None)
        .map(labels =>
          MatchIdentity(
            record.id,
            record.matchNoInEvent,
            record.playedAt,
            labels.gameTitleName,
            labels.seasonName
          )
        )
    })
