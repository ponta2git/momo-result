package momo.api.adapters.inmemory

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchExportContext, MatchExportRow, MatchRecord}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MapMastersRepository, MatchExportsRepository, MatchesRepository, MembersRepository, SeasonMastersRepository}

final class InMemoryMatchExportsRepository[F[_]: MonadThrow](
    matches: MatchesRepository[F],
    members: MembersRepository[F],
    maps: MapMastersRepository[F],
    seasons: SeasonMastersRepository[F],
) extends MatchExportsRepository[F]:
  override def project(selection: MatchExportsRepository.Selection): F[List[MatchExportRow]] =
    matches.list(MatchesRepository.ListFilter()).flatMap { all =>
      val seasonSequence = sequenceBy(all)(_.seasonMasterId)
      val titleSequence = sequenceBy(all)(_.gameTitleId)
      val selected = all.filter(record =>
        selection.heldEventId.forall(_ == record.heldEventId) &&
          selection.seasonMasterId.forall(_ == record.seasonMasterId) &&
          selection.matchId.forall(_ == record.id)
      ).take(selection.limit).sortBy(exportOrder)
      for
        names <- selected.flatMap(m => m.ownerMemberId :: m.players.toList.map(_.memberId)).distinct
          .traverse(id => requireValue(members.find(id), "member", id.value).map(m => id -> m.displayName)).map(_.toMap)
        mapNames <- selected.map(_.mapMasterId).distinct.traverse(id =>
          requireValue(maps.find(id), "map", id.value).map(m => id -> m.name)
        ).map(_.toMap)
        seasonNames <- selected.map(_.seasonMasterId).distinct.traverse(id =>
          requireValue(seasons.find(id), "season", id.value).map(s => id -> s.name)
        ).map(_.toMap)
      yield selected.flatMap { record =>
        val context = MatchExportContext(seasonNames(record.seasonMasterId), seasonSequence(record.id),
          names(record.ownerMemberId), mapNames(record.mapMasterId), record.playedAt, titleSequence(record.id))
        record.players.byPlayOrder.map(player => context.row(player, names(player.memberId)))
      }
    }

  private def requireValue[A](value: F[Option[A]], label: String, id: String): F[A] = value.flatMap(
    _.toRight(new AppException(AppError.Internal(s"Export $label lookup failed for id: $id"))).liftTo[F]
  )

  private def sequenceBy[Id](records: List[MatchRecord])(key: MatchRecord => Id): Map[MatchId, Int] =
    records.sortBy(exportOrder).groupMap(key)(identity).valuesIterator
      .flatMap(_.iterator.zipWithIndex.map { case (record, index) => record.id -> (index + 1) }).toMap

  private def exportOrder(record: MatchRecord): (Long, String, Int, String) =
    (record.playedAt.toEpochMilli, record.heldEventId.value, record.matchNoInEvent.value, record.id.value)
