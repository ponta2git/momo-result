package momo.api.adapters.inmemory

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchNoInEvent, MatchRecord}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MatchExportsRepository, MatchesRepository}

final class InMemoryMatchesRepository[F[_]: Sync] private (ref: Ref[F, Map[MatchId, MatchRecord]])
    extends MatchesRepository[F], MatchExportsRepository[F]:
  def create(record: MatchRecord): F[Unit] = ref.modify { current =>
    if current.contains(record.id) || containsMatchNo(current, record, excluding = None) then
      (current, Left(conflict(record)))
    else (current.updated(record.id, record), Right(()))
  }.flatMap(complete)

  override def update(record: MatchRecord, updatedAt: java.time.Instant): F[Unit] = ref
    .modify { current =>
      if !current.contains(record.id) then (current, Left(notFound(record.id)))
      else if containsMatchNo(current, record, excluding = Some(record.id)) then
        (current, Left(conflict(record)))
      else (current.updated(record.id, record), Right(()))
    }.flatMap(complete)

  override def delete(id: MatchId): F[Boolean] = ref
    .modify(m => if m.contains(id) then (m - id, true) else (m, false))

  override def find(id: MatchId): F[Option[MatchRecord]] = ref.get.map(_.get(id))

  override def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]] = ref.get.map { m =>
    val filtered = m.values.filter { r =>
      filter.heldEventId.forall(_ == r.heldEventId) &&
      filter.gameTitleId.forall(_ == r.gameTitleId) &&
      filter.seasonMasterId.forall(_ == r.seasonMasterId) && filter.matchId.forall(_ == r.id)
    }.toList.sortBy(r => (-r.playedAt.toEpochMilli, -r.createdAt.toEpochMilli))
    filter.limit.fold(filtered)(filtered.take)
  }

  override def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]] = ref.get
    .map(_.values.filter(_.heldEventId == heldEventId).toList.sortBy(_.matchNoInEvent.value))

  override def project(
      selection: MatchExportsRepository.Selection
  ): F[List[MatchExportsRepository.ProjectedMatch]] = ref.get.map { stored =>
    val all = stored.values.toList
    val seasonSequence = sequenceBy(all)(_.seasonMasterId)
    val gameTitleSequence = sequenceBy(all)(_.gameTitleId)
    val selected = all.filter { record =>
      selection.heldEventId.forall(_ == record.heldEventId) &&
      selection.seasonMasterId.forall(_ == record.seasonMasterId) &&
      selection.matchId.forall(_ == record.id)
    }.sortBy(record => (-record.playedAt.toEpochMilli, -record.createdAt.toEpochMilli))
      .take(selection.limit).sortWith(comesBefore)

    selected.map { record =>
      MatchExportsRepository.ProjectedMatch(
        id = record.id,
        seasonMasterId = record.seasonMasterId,
        ownerMemberId = record.ownerMemberId,
        mapMasterId = record.mapMasterId,
        playedAt = record.playedAt,
        seasonSequence = seasonSequence(record.id),
        gameTitleSequence = gameTitleSequence(record.id),
        players = record.players,
      )
    }
  }

  override def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F[Boolean] =
    ref.get
      .map(_.values.exists(r => r.heldEventId == heldEventId && r.matchNoInEvent == matchNoInEvent))

  override def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      excludeMatchId: MatchId,
  ): F[Boolean] = ref.get.map(_.values.exists(r =>
    r.heldEventId == heldEventId && r.matchNoInEvent == matchNoInEvent && r.id != excludeMatchId
  ))

  override def statsByHeldEvents(
      heldEventIds: List[HeldEventId]
  ): F[Map[HeldEventId, MatchesRepository.HeldEventStats]] = ref.get.map { records =>
    val ids = heldEventIds.toSet
    val grouped = records.values.filter(record => ids.contains(record.heldEventId)).toList
      .groupBy(_.heldEventId)
    heldEventIds.map { id =>
      val scoped = grouped.getOrElse(id, Nil)
      id -> MatchesRepository.HeldEventStats(
        matchCount = scoped.size,
        maxMatchNo = scoped.map(_.matchNoInEvent.value).maxOption.getOrElse(0),
      )
    }.toMap
  }

  private def containsMatchNo(
      current: Map[MatchId, MatchRecord],
      record: MatchRecord,
      excluding: Option[MatchId],
  ): Boolean = current.values.exists(r =>
    !excluding.contains(r.id) && r.heldEventId == record.heldEventId &&
      r.matchNoInEvent == record.matchNoInEvent
  )

  private def conflict(record: MatchRecord): AppException =
    new AppException(AppError.Conflict(s"matchNoInEvent ${record.matchNoInEvent.value
        .toString} already exists for held event ${record.heldEventId.value}."))

  private def notFound(id: MatchId): AppException =
    new AppException(AppError.NotFound("match", id.value))

  private def complete(result: Either[AppException, Unit]): F[Unit] = result match
    case Right(()) => Sync[F].unit
    case Left(error) => Sync[F].raiseError(error)

  private def sequenceBy[Id](records: List[MatchRecord])(
      key: MatchRecord => Id
  ): Map[MatchId, Int] = records.sortWith(comesBefore).groupMap(key)(identity).valuesIterator
    .flatMap(_.iterator.zipWithIndex.map { case (record, index) => record.id -> (index + 1) }).toMap

  private def comesBefore(left: MatchRecord, right: MatchRecord): Boolean =
    val leftKey = (
      left.playedAt.toEpochMilli,
      left.heldEventId.value,
      left.matchNoInEvent.value,
      left.id.value,
    )
    val rightKey = (
      right.playedAt.toEpochMilli,
      right.heldEventId.value,
      right.matchNoInEvent.value,
      right.id.value,
    )
    leftKey < rightKey

object InMemoryMatchesRepository:
  def create[F[_]: Sync]: F[InMemoryMatchesRepository[F]] = Ref
    .of[F, Map[MatchId, MatchRecord]](Map.empty).map(new InMemoryMatchesRepository(_))

  def withConfirmedDraftCleanup[F[_]: Sync](
      matches: InMemoryMatchesRepository[F],
      matchDrafts: InMemoryMatchDraftsRepository[F],
  ): MatchesRepository[F] = new MatchesRepository[F]:
    override def update(record: MatchRecord, updatedAt: java.time.Instant): F[Unit] = matches
      .update(record, updatedAt)

    override def delete(id: MatchId): F[Boolean] = matches.delete(id).flatTap {
      case true => matchDrafts.deleteConfirmedByMatchId(id).void
      case false => Sync[F].unit
    }

    override def find(id: MatchId): F[Option[MatchRecord]] = matches.find(id)

    override def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]] = matches
      .list(filter)

    override def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]] = matches
      .listByHeldEvent(heldEventId)

    override def existsMatchNo(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
    ): F[Boolean] = matches.existsMatchNo(heldEventId, matchNoInEvent)

    override def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
        excludeMatchId: MatchId,
    ): F[Boolean] = matches.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId)

    override def statsByHeldEvents(
        heldEventIds: List[HeldEventId]
    ): F[Map[HeldEventId, MatchesRepository.HeldEventStats]] =
      matches.statsByHeldEvents(heldEventIds)
