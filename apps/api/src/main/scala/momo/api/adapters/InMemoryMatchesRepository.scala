package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.domain.MatchRecord
import momo.api.domain.ids.*
import momo.api.repositories.MatchesRepository

final class InMemoryMatchesRepository[F[_]: Sync] private (ref: Ref[F, Map[MatchId, MatchRecord]])
    extends MatchesRepository[F]:
  override def create(record: MatchRecord): F[Unit] = ref.update(_ + (record.id -> record))

  override def update(record: MatchRecord, updatedAt: java.time.Instant): F[Unit] = ref
    .update(_ + (record.id -> record))

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
    .map(_.values.filter(_.heldEventId == heldEventId).toList.sortBy(_.matchNoInEvent))

  override def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: Int): F[Boolean] = ref.get
    .map(_.values.exists(r => r.heldEventId == heldEventId && r.matchNoInEvent == matchNoInEvent))

  override def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      excludeMatchId: MatchId,
  ): F[Boolean] = ref.get.map(_.values.exists(r =>
    r.heldEventId == heldEventId && r.matchNoInEvent == matchNoInEvent && r.id != excludeMatchId
  ))

  override def maxMatchNo(heldEventId: HeldEventId): F[Int] = ref.get.map { m =>
    val nums = m.values.filter(_.heldEventId == heldEventId).map(_.matchNoInEvent)
    if nums.isEmpty then 0 else nums.max
  }

  override def countByHeldEvents(heldEventIds: List[HeldEventId]): F[Map[HeldEventId, Int]] = ref
    .get.map { m =>
      val ids = heldEventIds.toSet
      val counts = m.values.filter(r => ids.contains(r.heldEventId))
        .groupMapReduce(_.heldEventId)(_ => 1)(_ + _)
      heldEventIds.map(id => id -> counts.getOrElse(id, 0)).toMap
    }

object InMemoryMatchesRepository:
  def create[F[_]: Sync]: F[InMemoryMatchesRepository[F]] = Ref
    .of[F, Map[MatchId, MatchRecord]](Map.empty).map(new InMemoryMatchesRepository(_))
