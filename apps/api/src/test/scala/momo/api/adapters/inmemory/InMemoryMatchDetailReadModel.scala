package momo.api.adapters.inmemory

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.ids.MatchId
import momo.api.domain.{
  AdjacentMatch,
  MatchDetail,
  MatchIdentity,
  MatchRecord,
  PublicId,
  RecordNavigation,
  RecordNavigationOrder
}
import momo.api.repositories.{LoginAccountsRepository, MatchDetailReadModel}

final class InMemoryMatchDetailReadModel[F[_]: MonadThrow](
    matches: MatchFixtureStore[F],
    accounts: LoginAccountsRepository[F],
    metadata: InMemoryMatchMetadata[F],
) extends MatchDetailReadModel[F]:
  // This fixture models the legacy schema; public-number reads are covered by real DB tests.
  override def findByPublicId(publicId: PublicId): F[Option[MatchDetail]] =
    none[MatchDetail].pure[F]

  override def find(id: MatchId): F[Option[MatchDetail]] =
    matches.list(MatchFixtureStore.ListFilter()).map(records =>
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
            labels.seasonName,
            gameTitleId = record.gameTitleId,
            mapMasterId = record.mapMasterId,
            analysisRevision = record.analysisRevision,
          )
        )
    })
