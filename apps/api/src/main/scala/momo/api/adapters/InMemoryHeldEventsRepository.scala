package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*
import momo.api.domain.HeldEvent
import momo.api.repositories.HeldEventsRepository

final class InMemoryHeldEventsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, HeldEvent]])
    extends HeldEventsRepository[F]:
  override def list(query: Option[String], limit: Int): F[List[HeldEvent]] = ref.get.map { events =>
    val filtered = query match
      case Some(q) if q.trim.nonEmpty =>
        val lower = q.toLowerCase
        events.values.filter(e => e.id.toLowerCase.contains(lower))
      case _ => events.values
    filtered.toList.sortBy(_.heldAt).reverse.take(math.max(limit, 0))
  }

  override def find(id: String): F[Option[HeldEvent]] = ref.get.map(_.get(id))

  override def create(event: HeldEvent): F[Unit] = ref.update(_ + (event.id -> event))

object InMemoryHeldEventsRepository:
  def create[F[_]: Sync]: F[InMemoryHeldEventsRepository[F]] = Ref
    .of[F, Map[String, HeldEvent]](Map.empty).map(new InMemoryHeldEventsRepository(_))
