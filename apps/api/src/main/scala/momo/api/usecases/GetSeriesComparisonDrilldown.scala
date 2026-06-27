package momo.api.usecases

import java.time.format.DateTimeFormatter

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.{MatchId, MemberId}
import momo.api.domain.{
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonResolvedScope,
  SeriesComparisonScope
}
import momo.api.endpoints.*
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel

final class GetSeriesComparisonDrilldown[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(
      scope: SeriesComparisonScope,
      metricId: String,
      memberId: MemberId,
  ): F[Either[AppError, SeriesComparisonDrilldownResponse]] = readModel.resolveScope(scope)
    .flatMap {
      case None => Monad[F]
          .pure(Left(AppError.NotFound("series comparison scope", scopeKey(scope))))
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows => Right(SeriesComparisonDrilldownAggregation.aggregate(
            resolved,
            metricId,
            memberId,
            rows,
          )))
    }

  private def scopeKey(scope: SeriesComparisonScope): String = scope.scopeIdValue
    .fold(scope.selectedGameTitleId.value)(id => s"${scope.selectedGameTitleId.value}:$id")

object GetSeriesComparisonDrilldown:
  def apply[F[_]: Monad](
      readModel: SeriesComparisonReadModel[F]
  ): GetSeriesComparisonDrilldown[F] =
    new GetSeriesComparisonDrilldown(readModel)

private object SeriesComparisonDrilldownAggregation:
  private val Formatter = DateTimeFormatter.ISO_INSTANT
  private val SchemaVersion = 1

  def aggregate(
      scope: SeriesComparisonResolvedScope,
      metricId: String,
      memberId: MemberId,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonDrilldownResponse =
    val sortedRows = rows.sortBy(rowSortKey)
    val matchIndexById = matchIndexByIdFrom(sortedRows)
    val targetRows = sortedRows.filter(_.memberId == memberId)
    val matchRows = rankAverageMatchRows(targetRows, matchIndexById)
    val heldEventRows = rankAverageEventRows(matchRows)
    val status = statusFor(targetRows.size)
    val displayName = targetRows.headOption.map(_.memberDisplayName).getOrElse(memberId.value)
    SeriesComparisonDrilldownResponse(
      schemaVersion = SchemaVersion,
      metricId = metricId,
      scope = scopeResponse(scope),
      player = SeriesComparisonPlayerResponse(memberId = memberId.value, displayName = displayName),
      summary = SeriesComparisonRankAverageHistorySummaryResponse(
        targetCount = targetRows.size,
        currentAverageRank = matchRows.lastOption.map(_.cumulativeAverageRank),
        averageRankDeltaFromFirst = Option.when(matchRows.size >= 2)(
          matchRows.last.cumulativeAverageRank - matchRows.head.cumulativeAverageRank
        ),
        latestHeldEventAverageRankDelta = heldEventRows.lastOption.flatMap(
          _.cumulativeAverageDelta
        ),
        status = status,
      ),
      matchRows = matchRows,
      heldEventRows = heldEventRows,
      dataQuality = SeriesComparisonDataQualityResponse(List(
        MetricQualityResponse(
          metricId = metricId,
          playerMemberId = Some(memberId.value),
          denominator = targetRows.size,
          targetCount = targetRows.size,
          status = status,
          hasTies = false,
        )
      )),
    )

  private def rankAverageMatchRows(
      rows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[MatchId, Int],
  ): List[SeriesComparisonRankAverageHistoryMatchRowResponse] =
    val ranks = rows.map(_.rank.value)
    rows.zipWithIndex.map { case (row, index) =>
      val currentRanks = ranks.take(index + 1)
      val previousRanks = ranks.take(index)
      val currentAverage = averageUnsafe(currentRanks)
      val previousAverage = Option.when(previousRanks.nonEmpty)(averageUnsafe(previousRanks))
      val previousRank = ranks.lift(index - 1)
      SeriesComparisonRankAverageHistoryMatchRowResponse(
        matchIndex = matchIndexById.getOrElse(row.matchId, index + 1),
        matchId = row.matchId.value,
        playedAt = Formatter.format(row.playedAt),
        heldEventId = row.heldEventId.value,
        matchNoInEvent = row.matchNoInEvent.value,
        rank = row.rank.value,
        previousRank = previousRank,
        rankDelta = previousRank.map(previous => row.rank.value - previous),
        cumulativeAverageRank = currentAverage,
        cumulativeAverageRankDelta = previousAverage.map(currentAverage - _),
      )
    }

  private def rankAverageEventRows(
      rows: List[SeriesComparisonRankAverageHistoryMatchRowResponse]
  ): List[SeriesComparisonRankAverageHistoryEventRowResponse] =
    rows.groupBy(_.heldEventId).toList.sortBy { case (_, eventRows) =>
      eventRows.map(_.matchIndex).minOption.getOrElse(Int.MaxValue)
    }.map { case (heldEventId, eventRows) =>
      val sorted = eventRows.sortBy(_.matchIndex)
      val ranks = sorted.map(_.rank)
      val first = sorted.head
      val last = sorted.last
      val cumulativeAverageBefore = first.cumulativeAverageRankDelta.map(delta =>
        first.cumulativeAverageRank - delta
      )
      SeriesComparisonRankAverageHistoryEventRowResponse(
        heldEventId = heldEventId,
        firstPlayedAt = first.playedAt,
        matchCount = sorted.size,
        ranks = ranks,
        eventAverageRank = averageUnsafe(ranks),
        eventRankDelta = Option.when(ranks.size >= 2)(ranks.last - ranks.head),
        cumulativeAverageBefore = cumulativeAverageBefore,
        cumulativeAverageAfter = last.cumulativeAverageRank,
        cumulativeAverageDelta = cumulativeAverageBefore.map(last.cumulativeAverageRank - _),
      )
    }

  private def matchIndexByIdFrom(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): Map[MatchId, Int] = rows.groupBy(_.matchId).toList.sortBy { case (_, groupRows) =>
    val first = groupRows.sortBy(rowSortKey).head
    rowSortKey(first)
  }.zipWithIndex.map { case ((matchId, _), index) => matchId -> (index + 1) }.toMap

  private def rowSortKey(row: SeriesComparisonMatchPlayerRow) =
    (
      row.playedAt.toEpochMilli,
      row.heldEventId.value,
      row.matchNoInEvent.value,
      row.matchId.value,
      row.memberId.value,
    )

  private def averageUnsafe(values: List[Int]): Double =
    values.sum * 1.0d / values.size

  private def statusFor(targetCount: Int): String =
    if targetCount <= 0 then "no_target" else if targetCount < 3 then "reference" else "ok"

  private def scopeResponse(scope: SeriesComparisonResolvedScope): SeriesComparisonScopeResponse =
    SeriesComparisonScopeResponse(
      gameTitleId = scope.gameTitleId.value,
      gameTitleName = scope.gameTitleName,
      layoutFamily = scope.layoutFamily,
      scopeKind = scope.scopeKind,
      scopeId = scope.scopeId,
      scopeName = scope.scopeName,
      seasonMasterId = scope.seasonMasterId.map(_.value),
      seasonName = scope.seasonName,
      mapMasterId = scope.mapMasterId.map(_.value),
      mapName = scope.mapName,
    )
