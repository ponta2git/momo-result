package momo.api.adapters

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  SeriesComparisonIncidentCountsRow,
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonOptionsData,
  SeriesComparisonResolvedScope,
  SeriesComparisonScope,
  SeriesComparisonScopeOptionData,
  SeriesComparisonSeriesOptionData
}
import momo.api.repositories.{
  GameTitlesRepository,
  MapMastersRepository,
  MatchesRepository,
  MembersRepository,
  SeasonMastersRepository,
  SeriesComparisonReadModel
}

final class InMemorySeriesComparisonReadModel[F[_]: Monad](
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    members: MembersRepository[F],
    matches: MatchesRepository[F],
) extends SeriesComparisonReadModel[F]:
  override def options: F[SeriesComparisonOptionsData] =
    for
      titles <- gameTitles.list
      seasons <- seasonMasters.list(None)
      maps <- mapMasters.list(None)
      records <- matches.list(MatchesRepository.ListFilter(limit = None))
    yield
      val recordsByTitle = records.groupBy(_.gameTitleId)
      val latest = records.sortBy(r => (-r.playedAt.toEpochMilli, r.gameTitleId.value, r.id.value))
        .headOption.map(_.gameTitleId)
      SeriesComparisonOptionsData(
        latestConfirmedGameTitleId = latest,
        series = titles.map { title =>
          val titleRecords = recordsByTitle.getOrElse(title.id, Nil)
          SeriesComparisonSeriesOptionData(
            gameTitleId = title.id,
            name = title.name,
            layoutFamily = title.layoutFamily,
            displayOrder = title.displayOrder,
            confirmedMatchCount = titleRecords.size,
            latestConfirmedPlayedAt = titleRecords.map(_.playedAt).maxOption,
            seasons = seasons.filter(_.gameTitleId == title.id).map { season =>
              SeriesComparisonScopeOptionData(
                id = season.id.value,
                name = season.name,
                displayOrder = season.displayOrder,
                confirmedMatchCount = titleRecords.count(_.seasonMasterId == season.id),
              )
            },
            maps = maps.filter(_.gameTitleId == title.id).map { map =>
              SeriesComparisonScopeOptionData(
                id = map.id.value,
                name = map.name,
                displayOrder = map.displayOrder,
                confirmedMatchCount = titleRecords.count(_.mapMasterId == map.id),
              )
            },
          )
        },
      )

  override def resolveScope(
      scope: SeriesComparisonScope
  ): F[Option[SeriesComparisonResolvedScope]] = scope match
    case SeriesComparisonScope.Overall(gameTitleId) => gameTitles.find(gameTitleId).map(_.map(gt =>
        SeriesComparisonResolvedScope(
          gameTitleId = gt.id,
          gameTitleName = gt.name,
          layoutFamily = gt.layoutFamily,
          scopeKind = "overall",
          scopeId = None,
          scopeName = "総合",
        )
      ))
    case SeriesComparisonScope.Season(gameTitleId, seasonMasterId) =>
      (gameTitles.find(gameTitleId), seasonMasters.find(seasonMasterId)).mapN { (title, season) =>
        for
          gt <- title
          s <- season if s.gameTitleId == gameTitleId
        yield SeriesComparisonResolvedScope(
          gameTitleId = gt.id,
          gameTitleName = gt.name,
          layoutFamily = gt.layoutFamily,
          scopeKind = "season",
          scopeId = Some(s.id.value),
          scopeName = s.name,
          seasonMasterId = Some(s.id),
          seasonName = Some(s.name),
        )
      }
    case SeriesComparisonScope.Map(gameTitleId, mapMasterId) =>
      (gameTitles.find(gameTitleId), mapMasters.find(mapMasterId)).mapN { (title, map) =>
        for
          gt <- title
          m <- map if m.gameTitleId == gameTitleId
        yield SeriesComparisonResolvedScope(
          gameTitleId = gt.id,
          gameTitleName = gt.name,
          layoutFamily = gt.layoutFamily,
          scopeKind = "map",
          scopeId = Some(m.id.value),
          scopeName = m.name,
          mapMasterId = Some(m.id),
          mapName = Some(m.name),
        )
      }
    case SeriesComparisonScope.SeasonMap(gameTitleId, seasonMasterId, mapMasterId) => (
        gameTitles.find(gameTitleId),
        seasonMasters.find(seasonMasterId),
        mapMasters.find(mapMasterId),
      ).mapN { (title, season, map) =>
        for
          gt <- title
          s <- season if s.gameTitleId == gameTitleId
          m <- map if m.gameTitleId == gameTitleId
        yield SeriesComparisonResolvedScope(
          gameTitleId = gt.id,
          gameTitleName = gt.name,
          layoutFamily = gt.layoutFamily,
          scopeKind = "season_map",
          scopeId = None,
          scopeName = s"${s.name} / ${m.name}",
          seasonMasterId = Some(s.id),
          seasonName = Some(s.name),
          mapMasterId = Some(m.id),
          mapName = Some(m.name),
        )
      }

  override def loadRows(
      scope: SeriesComparisonResolvedScope
  ): F[List[SeriesComparisonMatchPlayerRow]] =
    for
      records <- matches.list(MatchesRepository.ListFilter(
        gameTitleId = Some(scope.gameTitleId),
        seasonMasterId = scope.seasonMasterId,
        limit = None,
      ))
      membersList <- members.list
    yield
      val memberNames = membersList.map(m => m.id -> m.displayName).toMap
      val scopedRecords = scope.mapMasterId.fold(records)(id => records.filter(_.mapMasterId == id))
      scopedRecords.sortBy(r =>
        (r.playedAt.toEpochMilli, r.heldEventId.value, r.matchNoInEvent.value, r.id.value)
      ).flatMap { record =>
        record.players.byPlayOrder.map { player =>
          SeriesComparisonMatchPlayerRow(
            matchId = record.id,
            playedAt = record.playedAt,
            heldEventId = record.heldEventId,
            matchNoInEvent = record.matchNoInEvent,
            gameTitleId = record.gameTitleId,
            seasonMasterId = record.seasonMasterId,
            mapMasterId = record.mapMasterId,
            memberId = player.memberId,
            memberDisplayName = memberNames.getOrElse(player.memberId, player.memberId.value),
            playOrder = player.playOrder,
            rank = player.rank,
            totalAssetsManYen = player.totalAssetsManYen,
            revenueManYen = player.revenueManYen,
            incidents = SeriesComparisonIncidentCountsRow(
              destination = player.incidents.destination.value,
              plusStation = player.incidents.plusStation.value,
              minusStation = player.incidents.minusStation.value,
              cardStation = player.incidents.cardStation.value,
              cardShop = player.incidents.cardShop.value,
              suriNoGinji = player.incidents.suriNoGinji.value,
            ),
          )
        }
      }
