package momo.api.bootstrap

import cats.effect.Async
import cats.syntax.all.*

import momo.api.adapters.inmemory.InMemoryMatchDraftsRepository
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MapMastersRepository, MatchesRepository, SeasonMastersRepository}

private[bootstrap] object InMemoryMasterDeleteGuards:
  def ensureGameTitleCanDelete[F[_]: Async](
      gameTitleId: GameTitleId,
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      matches: MatchesRepository[F],
      matchDrafts: InMemoryMatchDraftsRepository[F],
  ): F[Unit] =
    for
      scopedMaps <- mapMasters.list(Some(gameTitleId))
      scopedSeasons <- seasonMasters.list(Some(gameTitleId))
      matchRefs <- matches
        .list(MatchesRepository.ListFilter(gameTitleId = Some(gameTitleId), limit = Some(1)))
      draftRefs <- matchDrafts.existsBlockingReferenceToGameTitle(gameTitleId)
      _ <-
        if scopedMaps.nonEmpty || scopedSeasons.nonEmpty || matchRefs.nonEmpty || draftRefs then
          conflict[F]("game title is still referenced.")
        else matchDrafts.deleteDiscardedByGameTitle(gameTitleId).void
    yield ()

  def ensureMapMasterCanDelete[F[_]: Async](
      mapMasterId: MapMasterId,
      matches: MatchesRepository[F],
      matchDrafts: InMemoryMatchDraftsRepository[F],
  ): F[Unit] =
    for
      matchRefs <- matches.list(MatchesRepository.ListFilter())
        .map(_.exists(_.mapMasterId == mapMasterId))
      draftRefs <- matchDrafts.existsBlockingReferenceToMapMaster(mapMasterId)
      _ <-
        if matchRefs || draftRefs then
          conflict[F]("map master is still referenced.")
        else matchDrafts.deleteDiscardedByMapMaster(mapMasterId).void
    yield ()

  def ensureSeasonMasterCanDelete[F[_]: Async](
      seasonMasterId: SeasonMasterId,
      matches: MatchesRepository[F],
      matchDrafts: InMemoryMatchDraftsRepository[F],
  ): F[Unit] =
    for
      matchRefs <- matches
        .list(MatchesRepository.ListFilter(seasonMasterId = Some(seasonMasterId), limit = Some(1)))
      draftRefs <- matchDrafts.existsBlockingReferenceToSeasonMaster(seasonMasterId)
      _ <-
        if matchRefs.nonEmpty || draftRefs then
          conflict[F]("season master is still referenced.")
        else matchDrafts.deleteDiscardedBySeasonMaster(seasonMasterId).void
    yield ()

  private def conflict[F[_]: Async](detail: String): F[Unit] = Async[F]
    .raiseError(new AppException(AppError.Conflict(detail)))
