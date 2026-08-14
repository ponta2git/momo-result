package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.domain.{MatchListKindFilter, MatchListSort, MatchListStatusFilter}
import momo.api.errors.AppError
import momo.api.usecases.matches.ListMatchesCommand

/** Query-parameter ↔ command conversion for `MatchesEndpoints.list`. */
object MatchListCodec:
  def toListCommand(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      status: Option[String],
      kind: Option[String],
      pageSize: Option[Int],
      cursor: Option[String],
      sort: Option[String],
  ): Either[AppError, ListMatchesCommand] =
    for
      parsedHeldEventId <- BoundaryId.optional("heldEventId", heldEventId)(HeldEventId.fromString)
      parsedGameTitleId <- BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)
      parsedSeasonMasterId <- BoundaryId
        .optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
      parsedStatus <- parseStatus(status)
      parsedKind <- parseKind(kind)
      parsedSort <- parseSort(sort)
    yield ListMatchesCommand(
      heldEventId = parsedHeldEventId,
      gameTitleId = parsedGameTitleId,
      seasonMasterId = parsedSeasonMasterId,
      status = parsedStatus,
      kind = parsedKind,
      pageSize = pageSize,
      cursor = cursor,
      sort = parsedSort,
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
