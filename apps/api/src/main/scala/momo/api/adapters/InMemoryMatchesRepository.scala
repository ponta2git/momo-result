package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchNoInEvent, MatchRecord}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.MatchesRepository

final class InMemoryMatchesRepository[F[_]: Sync] private (ref: Ref[F, Map[MatchId, MatchRecord]])
    extends MatchesRepository[F]:
  override def create(record: MatchRecord): F[Unit] = ref.modify { current =>
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

  override def maxMatchNo(heldEventId: HeldEventId): F[Int] = ref.get.map { m =>
    val nums = m.values.filter(_.heldEventId == heldEventId).map(_.matchNoInEvent.value)
    if nums.isEmpty then 0 else nums.max
  }

  override def countByHeldEvents(heldEventIds: List[HeldEventId]): F[Map[HeldEventId, Int]] = ref
    .get.map { m =>
      val ids = heldEventIds.toSet
      val counts = m.values.filter(r => ids.contains(r.heldEventId))
        .groupMapReduce(_.heldEventId)(_ => 1)(_ + _)
      heldEventIds.map(id => id -> counts.getOrElse(id, 0)).toMap
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

object InMemoryMatchesRepository:
  def create[F[_]: Sync]: F[InMemoryMatchesRepository[F]] = Ref
    .of[F, Map[MatchId, MatchRecord]](Map.empty).map(new InMemoryMatchesRepository(_))

  def withConfirmedDraftCleanup[F[_]: Sync](
      matches: InMemoryMatchesRepository[F],
      matchDrafts: InMemoryMatchDraftsRepository[F],
  ): MatchesRepository[F] = new MatchesRepository[F]:
    override def create(record: MatchRecord): F[Unit] = matches.create(record)

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

    override def maxMatchNo(heldEventId: HeldEventId): F[Int] = matches.maxMatchNo(heldEventId)

    override def countByHeldEvents(heldEventIds: List[HeldEventId]): F[Map[HeldEventId, Int]] =
      matches.countByHeldEvents(heldEventIds)
