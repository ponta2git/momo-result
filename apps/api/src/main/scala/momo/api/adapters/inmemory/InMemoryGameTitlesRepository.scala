package momo.api.adapters.inmemory

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

final class InMemoryGameTitlesRepository[F[_]: Sync] private (
    ref: Ref[F, Map[GameTitleId, GameTitle]],
    beforeDelete: GameTitleId => F[Unit],
) extends GameTitlesRepository[F]:
  override def list: F[List[GameTitle]] = ref.get
    .map(_.values.toList.sortBy(t => (t.displayOrder, t.createdAt, t.id.value)))
  override def find(id: GameTitleId): F[Option[GameTitle]] = ref.get.map(_.get(id))
  override def create(title: GameTitle): F[Unit] = ref.modify { items =>
    if containsGameTitleConflict(items, title, excluding = None) then
      (
        items,
        Left(masterConflict(s"game_title already exists: ${title.id.value} or ${title.name}")),
      )
    else (items.updated(title.id, title), Right(()))
  }.flatMap(completeUnit)
  override def createWithNextDisplayOrder(title: GameTitle): F[GameTitle] = ref.modify { items =>
    if containsGameTitleConflict(items, title, excluding = None) then
      (
        items,
        Left(masterConflict(s"game_title already exists: ${title.id.value} or ${title.name}")),
      )
    else
      val nextOrder = items.values.map(_.displayOrder).maxOption.getOrElse(0) + 1
      val created = title.copy(displayOrder = nextOrder)
      (items.updated(created.id, created), Right(created))
  }.flatMap(complete)
  override def update(title: GameTitle): F[Unit] = ref.modify { items =>
    if !items.contains(title.id) then (items, Left(notFound("game title", title.id.value)))
    else if containsGameTitleConflict(items, title, excluding = Some(title.id)) then
      (
        items,
        Left(masterConflict(s"game_title already exists: ${title.id.value} or ${title.name}")),
      )
    else (items.updated(title.id, title), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: GameTitleId): F[Unit] = ref.get.flatMap { items =>
    if !items.contains(id) then Sync[F].raiseError(notFound("game title", id.value))
    else
      beforeDelete(id) *> ref.modify { current =>
        if current.contains(id) then (current - id, Right(()))
        else (current, Left(notFound("game title", id.value)))
      }.flatMap(completeUnit)
  }

  private def containsGameTitleConflict(
      items: Map[GameTitleId, GameTitle],
      title: GameTitle,
      excluding: Option[GameTitleId],
  ): Boolean = items.values.exists(existing =>
    !excluding.contains(existing.id) && (existing.id == title.id || existing.name == title.name)
  )

object InMemoryGameTitlesRepository:
  def create[F[_]: Sync]: F[InMemoryGameTitlesRepository[F]] = Ref
    .of[F, Map[GameTitleId, GameTitle]](Map.empty)
    .map(new InMemoryGameTitlesRepository(_, _ => Sync[F].unit))

  def createWithDeleteGuard[F[_]: Sync](
      beforeDelete: GameTitleId => F[Unit]
  ): F[InMemoryGameTitlesRepository[F]] = Ref.of[F, Map[GameTitleId, GameTitle]](Map.empty)
    .map(new InMemoryGameTitlesRepository(_, beforeDelete))
