package momo.api.adapters

import cats.effect.Ref
import cats.effect.Sync
import cats.syntax.functor.*
import momo.api.domain.MatchRecord
import momo.api.repositories.MatchesRepository

final class InMemoryMatchesRepository[F[_]: Sync] private (
    ref: Ref[F, Map[String, MatchRecord]]
) extends MatchesRepository[F]:
  override def create(record: MatchRecord): F[Unit] =
    ref.update(_ + (record.id -> record))

  override def find(id: String): F[Option[MatchRecord]] =
    ref.get.map(_.get(id))

  override def listByHeldEvent(heldEventId: String): F[List[MatchRecord]] =
    ref.get.map(_.values.filter(_.heldEventId == heldEventId).toList.sortBy(_.matchNoInEvent))

  override def existsMatchNo(heldEventId: String, matchNoInEvent: Int): F[Boolean] =
    ref.get.map(
      _.values.exists(r => r.heldEventId == heldEventId && r.matchNoInEvent == matchNoInEvent)
    )

  override def maxMatchNo(heldEventId: String): F[Int] =
    ref.get.map { m =>
      val nums = m.values.filter(_.heldEventId == heldEventId).map(_.matchNoInEvent)
      if nums.isEmpty then 0 else nums.max
    }

  override def countByHeldEvents(heldEventIds: List[String]): F[Map[String, Int]] =
    ref.get.map { m =>
      val ids = heldEventIds.toSet
      val counts = m.values
        .filter(r => ids.contains(r.heldEventId))
        .groupMapReduce(_.heldEventId)(_ => 1)(_ + _)
      heldEventIds.map(id => id -> counts.getOrElse(id, 0)).toMap
    }

object InMemoryMatchesRepository:
  def create[F[_]: Sync]: F[InMemoryMatchesRepository[F]] =
    Ref.of[F, Map[String, MatchRecord]](Map.empty).map(new InMemoryMatchesRepository(_))
