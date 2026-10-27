package momo.api.endpoints.codec

import scala.util.Try

import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  HeldEventListMetric,
  HeldEventListMetricCriterion,
  HeldEventListSearchCriteria,
  HeldEventListSort,
  MatchListRecordRange
}
import momo.api.errors.AppError
import momo.api.usecases.heldevents.ListHeldEventsCommand

/** Query-parameter ↔ command conversion for `HeldEventsEndpoints.list`. */
object HeldEventListCodec:
  private val AverageRankValue = "[0-9]+(\\.[0-9]{1,2})?".r
  private val CountValue = "[0-9]+".r

  final case class SearchParams(
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
      from: Option[String],
      to: Option[String],
      minMatchCount: Option[Int],
      q: Option[String],
      memberId: Option[String],
      metric: Option[String],
      metricValue: Option[String],
      metricRange: Option[String],
  )

  object SearchParams:
    val empty: SearchParams =
      SearchParams(None, None, None, None, None, None, None, None, None, None, None)

  def toListCommand(
      limit: Option[Int],
      page: Option[Int],
      pageSize: Option[Int],
      sort: Option[String],
      search: SearchParams,
  ): Either[AppError, ListHeldEventsCommand] =
    for
      parsedSort <- parseSort(sort)
      parsedSearch <- parseSearch(search)
    yield ListHeldEventsCommand(
      limit = limit,
      page = page,
      pageSize = pageSize,
      sort = parsedSort,
      search = parsedSearch,
    )

  private def parseSearch(params: SearchParams): Either[AppError, HeldEventListSearchCriteria] =
    for
      gameTitleId <- BoundaryId.optional("gameTitleId", params.gameTitleId)(GameTitleId.fromString)
      seasonMasterId <- BoundaryId
        .optional("seasonMasterId", params.seasonMasterId)(SeasonMasterId.fromString)
      mapMasterId <- BoundaryId.optional("mapMasterId", params.mapMasterId)(MapMasterId.fromString)
      from <- params.from.traverse(MatchListCodec.parseDate("from", _))
      to <- params.to.traverse(MatchListCodec.parseDate("to", _))
      _ <- Either.cond(
        (from, to).tupled.forall { case (start, end) => !start.isAfter(end) },
        (),
        AppError.ValidationFailed("from must be on or before to."),
      )
      minMatchCount <- params.minMatchCount.traverse(value =>
        Either.cond(
          value >= 1,
          value,
          AppError.ValidationFailed("minMatchCount must be 1 or greater.")
        )
      )
      noteQuery <- MatchListCodec.parseNoteQuery(params.q)
      metric <- parseMetric(params)
    yield HeldEventListSearchCriteria(
      gameTitleId = gameTitleId,
      seasonMasterId = seasonMasterId,
      mapMasterId = mapMasterId,
      from = from,
      to = to,
      minMatchCount = minMatchCount,
      noteQuery = noteQuery,
      metric = metric,
    )

  private def parseMetric(
      params: SearchParams
  ): Either[AppError, Option[HeldEventListMetricCriterion]] = params.metric match
    case None =>
      val dependent = List(
        params.metricValue.map(_ => "metricValue"),
        params.metricRange.map(_ => "metricRange"),
        params.memberId.map(_ => "memberId"),
      ).flatten
      dependent.headOption
        .fold(Right(None): Either[AppError, Option[HeldEventListMetricCriterion]])(name =>
          Left(AppError.ValidationFailed(s"$name requires metric."))
        )
    case Some(rawMetric) =>
      for
        metric <- HeldEventListMetric.fromWire(rawMetric).toRight(AppError.ValidationFailed(
          s"metric must be one of ${HeldEventListMetric.values.map(_.wire).mkString(", ")}: $rawMetric"
        ))
        rawValue <- params.metricValue
          .toRight(AppError.ValidationFailed("metricValue is required when metric is specified."))
        value <- parseMetricValue(metric, rawValue)
        range <- params.metricRange.fold(Right(MatchListRecordRange.Gte): Either[
          AppError,
          MatchListRecordRange,
        ])(raw =>
          MatchListRecordRange.fromWire(raw)
            .toRight(AppError.ValidationFailed(s"metricRange must be gte or lte: $raw"))
        )
        memberId <- BoundaryId.optional("memberId", params.memberId)(MemberId.fromString)
      yield Some(HeldEventListMetricCriterion(metric, value, range, memberId))

  private def parseMetricValue(
      metric: HeldEventListMetric,
      raw: String,
  ): Either[AppError, BigDecimal] = metric.countedRank match
    case None =>
      val invalid = AppError.ValidationFailed(
        "metricValue must be a number from 1.00 to 4.00 with at most 2 decimal places " +
          "for average_rank."
      )
      Option.when(AverageRankValue.matches(raw))(BigDecimal(raw)).filter(value =>
        value >= HeldEventListMetric.AverageRankMinimum &&
          value <= HeldEventListMetric.AverageRankMaximum
      ).toRight(invalid)
    case Some(_) =>
      val invalid =
        AppError.ValidationFailed("metricValue must be an integer of 0 or greater for rank counts.")
      Option.when(CountValue.matches(raw))(Try(raw.toInt).toOption).flatten.map(BigDecimal(_))
        .toRight(invalid)

  private def parseSort(sort: Option[String]): Either[AppError, HeldEventListSort] = sort
    .fold(Right(HeldEventListSort.HeldDesc): Either[AppError, HeldEventListSort])(other =>
      HeldEventListSort.fromWire(other)
        .toRight(AppError.ValidationFailed(s"sort must be held_desc or held_asc: $other"))
    )
end HeldEventListCodec
