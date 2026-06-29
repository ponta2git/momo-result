package momo.api.adapters.inmemory

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

final class InMemorySeasonMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[SeasonMasterId, SeasonMaster]],
    beforeDelete: SeasonMasterId => F[Unit],
) extends SeasonMastersRepository[F]:
  override def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] = ref.get.map { m =>
    val items = gameTitleId match
      case Some(id) => m.values.filter(_.gameTitleId == id)
      case None => m.values
    items.toList.sortBy(x => (x.gameTitleId.value, x.displayOrder, x.createdAt, x.id.value))
  }
  override def find(id: SeasonMasterId): F[Option[SeasonMaster]] = ref.get.map(_.get(id))
  override def create(season: SeasonMaster): F[Unit] = ref.modify { items =>
    if containsSeasonConflict(items, season, excluding = None) then
      (
        items,
        Left(masterConflict(s"season_master already exists: ${season.id.value} or ${season.name}")),
      )
    else (items.updated(season.id, season), Right(()))
  }.flatMap(completeUnit)
  override def createWithNextDisplayOrder(season: SeasonMaster): F[SeasonMaster] = ref
    .modify { items =>
      if containsSeasonConflict(items, season, excluding = None) then
        (
          items,
          Left(masterConflict(s"season_master already exists: ${season.id.value} or ${season
              .name}")),
        )
      else
        val nextOrder = items.values.filter(_.gameTitleId == season.gameTitleId).map(_.displayOrder)
          .maxOption.getOrElse(0) + 1
        val created = season.copy(displayOrder = nextOrder)
        (items.updated(created.id, created), Right(created))
    }.flatMap(complete)
  override def update(season: SeasonMaster): F[Unit] = ref.modify { items =>
    if !items.contains(season.id) then (items, Left(notFound("season master", season.id.value)))
    else if containsSeasonConflict(items, season, excluding = Some(season.id)) then
      (
        items,
        Left(masterConflict(s"season_master already exists: ${season.id.value} or ${season.name}")),
      )
    else (items.updated(season.id, season), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: SeasonMasterId): F[Unit] = ref.get.flatMap { items =>
    if !items.contains(id) then Sync[F].raiseError(notFound("season master", id.value))
    else
      beforeDelete(id) *> ref.modify { current =>
        if current.contains(id) then (current - id, Right(()))
        else (current, Left(notFound("season master", id.value)))
      }.flatMap(completeUnit)
  }

  private def containsSeasonConflict(
      items: Map[SeasonMasterId, SeasonMaster],
      season: SeasonMaster,
      excluding: Option[SeasonMasterId],
  ): Boolean = items.values.exists(existing =>
    !excluding.contains(existing.id) &&
      (existing.id == season.id ||
        (existing.gameTitleId == season.gameTitleId && existing.name == season.name))
  )

object InMemorySeasonMastersRepository:
  def create[F[_]: Sync]: F[InMemorySeasonMastersRepository[F]] = Ref
    .of[F, Map[SeasonMasterId, SeasonMaster]](Map.empty)
    .map(new InMemorySeasonMastersRepository(_, _ => Sync[F].unit))

  def createWithDeleteGuard[F[_]: Sync](
      beforeDelete: SeasonMasterId => F[Unit]
  ): F[InMemorySeasonMastersRepository[F]] = Ref.of[F, Map[SeasonMasterId, SeasonMaster]](Map.empty)
    .map(new InMemorySeasonMastersRepository(_, beforeDelete))
