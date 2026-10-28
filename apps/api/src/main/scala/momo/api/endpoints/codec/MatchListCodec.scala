package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchListKindFilter,
  MatchListRecordCriterion,
  MatchListRecordField,
  MatchListRecordRange,
  MatchListSearchCriteria,
  MatchListSort,
  MatchListStatusFilter
}
import momo.api.errors.AppError
import momo.api.usecases.matches.ListMatchesCommand

/** Query-parameter ↔ command conversion for `MatchesEndpoints.list`. */
object MatchListCodec:
  final case class SearchParams(
      mapMasterId: Option[String],
      from: Option[String],
      to: Option[String],
      q: Option[String],
      memberId: Option[String],
      record: Option[String],
      recordValue: Option[Int],
      recordRange: Option[String],
  )

  object SearchParams:
    val empty: SearchParams = SearchParams(None, None, None, None, None, None, None, None)

  def toListCommand(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      status: Option[String],
      kind: Option[String],
      pageSize: Option[Int],
      cursor: Option[String],
      sort: Option[String],
      search: SearchParams,
  ): Either[AppError, ListMatchesCommand] =
    for
      parsedHeldEventId <- BoundaryId.optional("heldEventId", heldEventId)(HeldEventId.fromString)
      parsedGameTitleId <- BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)
      parsedSeasonMasterId <- BoundaryId
        .optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
      parsedStatus <- parseStatus(status)
      parsedKind <- parseKind(kind)
      parsedSort <- parseSort(sort)
      parsedSearch <- parseSearch(search)
      _ <- Either.cond(
        parsedSearch.isEmpty || parsedKind == MatchListKindFilter.Match,
        (),
        AppError.ValidationFailed(
          "kind must be match when mapMasterId, from, to, q, or record is specified."
        ),
      )
    yield ListMatchesCommand(
      heldEventId = parsedHeldEventId,
      gameTitleId = parsedGameTitleId,
      seasonMasterId = parsedSeasonMasterId,
      status = parsedStatus,
      kind = parsedKind,
      pageSize = pageSize,
      cursor = cursor,
      sort = parsedSort,
      search = parsedSearch,
    )

  def parseSummaryFilter(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
  ): Either[AppError, (Option[HeldEventId], Option[GameTitleId], Option[SeasonMasterId])] =
    for
      parsedHeldEventId <- BoundaryId.optional("heldEventId", heldEventId)(HeldEventId.fromString)
      parsedGameTitleId <- BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)
      parsedSeasonMasterId <- BoundaryId
        .optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
    yield (parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId)

  private def parseSearch(params: SearchParams): Either[AppError, MatchListSearchCriteria] =
    for
      mapMasterId <- BoundaryId.optional("mapMasterId", params.mapMasterId)(MapMasterId.fromString)
      (from, to) <- ListSearchCodec.parseDateRange(params.from, params.to)
      noteQuery <- ListSearchCodec.parseNoteQuery(params.q)
      record <- parseRecord(params)
    yield MatchListSearchCriteria(mapMasterId, from, to, noteQuery, record)

  private def parseRecord(
      params: SearchParams
  ): Either[AppError, Option[MatchListRecordCriterion]] = params.record match
    case None =>
      val dependent = List(
        params.recordValue.map(_ => "recordValue"),
        params.recordRange.map(_ => "recordRange"),
        params.memberId.map(_ => "memberId"),
      ).flatten
      dependent.headOption
        .fold(Right(None): Either[AppError, Option[MatchListRecordCriterion]])(name =>
          Left(AppError.ValidationFailed(s"$name requires record."))
        )
    case Some(rawField) =>
      for
        field <- MatchListRecordField.fromWire(rawField).toRight(AppError.ValidationFailed(
          s"record must be one of ${MatchListRecordField.values.map(_.wire).mkString(", ")}: $rawField"
        ))
        value <- params.recordValue
          .toRight(AppError.ValidationFailed("recordValue is required when record is specified."))
        _ <- Either.cond(
          field.incidentKind.isEmpty || value >= 0,
          (),
          AppError.ValidationFailed("recordValue must be 0 or greater for incident records."),
        )
        range <- params.recordRange.fold(Right(MatchListRecordRange.Gte): Either[
          AppError,
          MatchListRecordRange,
        ])(raw =>
          MatchListRecordRange.fromWire(raw)
            .toRight(AppError.ValidationFailed(s"recordRange must be gte or lte: $raw"))
        )
        memberId <- BoundaryId.optional("memberId", params.memberId)(MemberId.fromString)
      yield Some(MatchListRecordCriterion(field, value, range, memberId))

  private def parseStatus(status: Option[String]): Either[AppError, MatchListStatusFilter] = status
    .fold(Right(MatchListStatusFilter.All): Either[AppError, MatchListStatusFilter])(other =>
      MatchListStatusFilter.fromWire(other).toRight(AppError.ValidationFailed(
        s"status must be all, incomplete, ocr_running, pre_confirm, needs_review, or confirmed: $other"
      ))
    )

  private def parseKind(kind: Option[String]): Either[AppError, MatchListKindFilter] = kind match
    case None | Some("all") => Right(MatchListKindFilter.All)
    case Some(value) if MatchListKindFilter.fromWire(value).nonEmpty =>
      Right(MatchListKindFilter.fromWire(value).get)
    case Some(other) =>
      Left(AppError.ValidationFailed(s"kind must be match or match_draft: $other"))

  private def parseSort(sort: Option[String]): Either[AppError, MatchListSort] = sort
    .fold(Right(MatchListSort.StatusPriority): Either[AppError, MatchListSort])(other =>
      MatchListSort.fromWire(other).toRight(AppError.ValidationFailed(
        s"sort must be status_priority, updated_desc, held_desc, held_asc, or match_no_asc: $other"
      ))
    )
end MatchListCodec
