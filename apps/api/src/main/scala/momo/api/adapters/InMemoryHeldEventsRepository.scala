package momo.api.adapters

import cats.Monad
import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId
import momo.api.repositories.{
  HeldEventDeletionAlg, HeldEventDeletionRepository, HeldEventDeletionResult, HeldEventsAlg,
  HeldEventsRepository, MatchDraftsRepository, MatchesRepository,
}

final class InMemoryHeldEventsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[HeldEventId, HeldEvent]]
) extends HeldEventsRepository[F]:
  private val alg: HeldEventsAlg[F] = new HeldEventsAlg[F]:
    override def list(query: Option[String], limit: Int): F[List[HeldEvent]] = ref.get
      .map(events => InMemoryHeldEventsRepository.filterAndSort(events.values, query, limit))
    override def find(id: HeldEventId): F[Option[HeldEvent]] = ref.get.map(_.get(id))
    override def create(event: HeldEvent): F[Unit] = ref.update(_ + (event.id -> event))
    override def delete(id: HeldEventId): F[Boolean] = ref
      .modify(current => if current.contains(id) then (current - id, true) else (current, false))

  private val delegate: HeldEventsRepository[F] = HeldEventsRepository.liftIdentity(alg)

  override def list(query: Option[String], limit: Int): F[List[HeldEvent]] = delegate
    .list(query, limit)
  override def find(id: HeldEventId): F[Option[HeldEvent]] = delegate.find(id)
  override def create(event: HeldEvent): F[Unit] = delegate.create(event)
  override def delete(id: HeldEventId): F[Boolean] = delegate.delete(id)

final class InMemoryHeldEventDeletionRepository[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    drafts: MatchDraftsRepository[F],
) extends HeldEventDeletionRepository[F]:
  private val alg: HeldEventDeletionAlg[F] = new HeldEventDeletionAlg[F]:
    override def deleteIfUnreferenced(id: HeldEventId): F[HeldEventDeletionResult] = events.find(id)
      .flatMap {
        case None => Monad[F].pure(HeldEventDeletionResult.NotFound)
        case Some(_) =>
          for
            matchCounts <- matches.countByHeldEvents(List(id))
            draftRefs <- drafts
              .list(MatchDraftsRepository.ListFilter(heldEventId = Some(id), limit = Some(1)))
            result <-
              if matchCounts.getOrElse(id, 0) > 0 then
                Monad[F].pure(HeldEventDeletionResult.HasConfirmedMatches)
              else if draftRefs.nonEmpty then Monad[F].pure(HeldEventDeletionResult.HasMatchDrafts)
              else
                events.delete(id).map(deleted =>
                  if deleted then HeldEventDeletionResult.Deleted
                  else HeldEventDeletionResult.NotFound
                )
          yield result
      }

  private val delegate: HeldEventDeletionRepository[F] = HeldEventDeletionRepository
    .liftIdentity(alg)

  override def deleteIfUnreferenced(id: HeldEventId): F[HeldEventDeletionResult] = delegate
    .deleteIfUnreferenced(id)

object InMemoryHeldEventsRepository:
  private[adapters] def filterAndSort(
      events: Iterable[HeldEvent],
      query: Option[String],
      limit: Int,
  ): List[HeldEvent] =
    val filtered = query match
      case Some(q) if q.trim.nonEmpty =>
        val lower = q.toLowerCase
        events.filter(e => e.id.value.toLowerCase.contains(lower))
      case _ => events
    filtered.toList.sortBy(_.heldAt).reverse.take(math.max(limit, 0))

  def create[F[_]: Sync]: F[InMemoryHeldEventsRepository[F]] = Ref
    .of[F, Map[HeldEventId, HeldEvent]](Map.empty).map(new InMemoryHeldEventsRepository(_))
end InMemoryHeldEventsRepository
