package momo.api.adapters.inmemory

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.*

final class InMemoryMapMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[MapMasterId, MapMaster]],
    beforeDelete: MapMasterId => F[Unit],
) extends MapMastersRepository[F]:
  override def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] = ref.get.map { m =>
    val items = gameTitleId match
      case Some(id) => m.values.filter(_.gameTitleId == id)
      case None => m.values
    items.toList.sortBy(x => (x.gameTitleId.value, x.displayOrder, x.createdAt, x.id.value))
  }
  override def find(id: MapMasterId): F[Option[MapMaster]] = ref.get.map(_.get(id))
  override def createWithNextDisplayOrder(
      map: MapMaster
  ): F[Either[AppError, MapMaster]] = ref.modify { items =>
    if containsMapConflict(items, map, excluding = None) then
      (items, Left(masterConflict(s"map_master already exists: ${map.id.value} or ${map.name}")))
    else
      val nextOrder = items.values.filter(_.gameTitleId == map.gameTitleId).map(_.displayOrder)
        .maxOption.getOrElse(0) + 1
      val created = map.copy(displayOrder = nextOrder)
      (items.updated(created.id, created), Right(created))
  }
  override def update(map: MapMaster): F[Either[AppError, Unit]] = ref.modify { items =>
    if !items.contains(map.id) then (items, Left(notFound("map master", map.id.value)))
    else if containsMapConflict(items, map, excluding = Some(map.id)) then
      (items, Left(masterConflict(s"map_master already exists: ${map.id.value} or ${map.name}")))
    else (items.updated(map.id, map), Right(()))
  }
  override def delete(id: MapMasterId): F[Either[AppError, Unit]] = ref.get.flatMap { items =>
    if !items.contains(id) then Left(notFound("map master", id.value)).pure[F]
    else
      RepositoryResult.capture(beforeDelete(id)).flatMap {
        case Left(error) => Left(error).pure[F]
        case Right(()) => ref.modify { current =>
            if current.contains(id) then (current - id, Right(()))
            else (current, Left(notFound("map master", id.value)))
          }
      }
  }

  private def containsMapConflict(
      items: Map[MapMasterId, MapMaster],
      map: MapMaster,
      excluding: Option[MapMasterId],
  ): Boolean = items.values.exists(existing =>
    !excluding.contains(existing.id) &&
      (existing.id == map.id ||
        (existing.gameTitleId == map.gameTitleId && existing.name == map.name))
  )

object InMemoryMapMastersRepository:
  def create[F[_]: Sync]: F[InMemoryMapMastersRepository[F]] = Ref
    .of[F, Map[MapMasterId, MapMaster]](Map.empty)
    .map(new InMemoryMapMastersRepository(_, _ => Sync[F].unit))

  def createWithDeleteGuard[F[_]: Sync](
      beforeDelete: MapMasterId => F[Unit]
  ): F[InMemoryMapMastersRepository[F]] = Ref.of[F, Map[MapMasterId, MapMaster]](Map.empty)
    .map(new InMemoryMapMastersRepository(_, beforeDelete))
