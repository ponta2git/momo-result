package momo.api.adapters.inmemory

import java.time.Instant

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.MatchLabels
import momo.api.domain.ids.*
import momo.api.repositories.{
  GameTitlesRepository,
  HeldEventsRepository,
  MapMastersRepository,
  SeasonMastersRepository
}

final class InMemoryMatchMetadata[F[_]: Monad](
    events: HeldEventsRepository[F],
    titles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
    maps: MapMastersRepository[F],
):
  def heldAt(id: Option[HeldEventId]): F[Option[Instant]] =
    id.traverse(events.find).map(_.flatten.map(_.heldAt))

  def labels(
      titleId: Option[GameTitleId],
      seasonId: Option[SeasonMasterId],
      mapId: Option[MapMasterId],
  ): F[MatchLabels] =
    for
      title <- titleId.traverse(titles.find)
      season <- seasonId.traverse(seasons.find)
      map <- mapId.traverse(maps.find)
    yield MatchLabels(
      title.flatten.map(_.name),
      season.flatten.map(_.name),
      map.flatten.map(_.name)
    )
