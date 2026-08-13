package momo.api.adapters.inmemory

import cats.Monad
import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, PageRequest, PagedResult}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  HeldEventDeletionAlg,
  HeldEventDeletionRepository,
  HeldEventDeletionResult,
  HeldEventsAlg,
  HeldEventsRepository,
  MatchDraftsRepository,
  MatchesRepository
}

final class InMemoryHeldEventsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[HeldEventId, HeldEvent]]
) extends HeldEventsRepository[F]:
  private val alg: HeldEventsAlg[F] = new HeldEventsAlg[F]:
    override def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]] = ref
      .get.map { events =>
        val all = InMemoryHeldEventsRepository.filterAndSort(events.values, query)
        val pageItems = all.slice(page.offset.toInt, page.offset.toInt + page.pageSize)
        PagedResult(pageItems, page, all.size)
      }
    override def listIds(query: Option[String]): F[List[HeldEventId]] = ref.get.map(events =>
      InMemoryHeldEventsRepository.filterAndSort(events.values, query).map(_.id)
    )
    override def find(id: HeldEventId): F[Option[HeldEvent]] = ref.get.map(_.get(id))
    override def create(event: HeldEvent): F[Unit] = ref.modify { current =>
      if current.contains(event.id) then (current, false) else (current + (event.id -> event), true)
    }.flatMap {
      case true => Sync[F].unit
      case false => Sync[F]
          .raiseError(new AppException(AppError.Conflict(s"held event already exists: ${event.id
              .value}")))
    }

  private val delegate: HeldEventsRepository[F] = HeldEventsRepository.liftIdentity(alg)

  override def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]] =
    delegate.listPage(query, page)
  override def listIds(query: Option[String]): F[List[HeldEventId]] = delegate.listIds(query)
  override def find(id: HeldEventId): F[Option[HeldEvent]] = delegate.find(id)
  override def create(event: HeldEvent): F[Unit] = delegate.create(event)

  private[inmemory] def deleteUnchecked(id: HeldEventId): F[Boolean] = ref
    .modify(current => if current.contains(id) then (current - id, true) else (current, false))

final class InMemoryHeldEventDeletionRepository[F[_]: Monad](
    events: InMemoryHeldEventsRepository[F],
    matches: MatchesRepository[F],
    drafts: MatchDraftsRepository[F],
) extends HeldEventDeletionRepository[F]:
  private val alg: HeldEventDeletionAlg[F] = new HeldEventDeletionAlg[F]:
    override def deleteIfUnreferenced(id: HeldEventId): F[HeldEventDeletionResult] = events.find(id)
      .flatMap {
        case None => Monad[F].pure(HeldEventDeletionResult.NotFound)
        case Some(_) =>
          for
            matchStats <- matches.statsByHeldEvents(List(id))
            draftRefs <- drafts
              .list(MatchDraftsRepository.ListFilter(heldEventId = Some(id), limit = Some(1)))
            result <-
              if matchStats.get(id).exists(_.matchCount > 0) then
                Monad[F].pure(HeldEventDeletionResult.HasConfirmedMatches)
              else if draftRefs.nonEmpty then Monad[F].pure(HeldEventDeletionResult.HasMatchDrafts)
              else
                events.deleteUnchecked(id).map(deleted =>
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
  ): List[HeldEvent] =
    val filtered = query match
      case Some(q) if q.trim.nonEmpty =>
        val lower = q.toLowerCase
        events.filter(e => e.id.value.toLowerCase.contains(lower))
      case _ => events
    filtered.toList.sortBy(event => (event.heldAt, event.id.value)).reverse

  def create[F[_]: Sync]: F[InMemoryHeldEventsRepository[F]] = Ref
    .of[F, Map[HeldEventId, HeldEvent]](Map.empty).map(new InMemoryHeldEventsRepository(_))
end InMemoryHeldEventsRepository
