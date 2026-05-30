package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.domain.{MatchListKindFilter, MatchListSort, MatchListStatusFilter}
import momo.api.errors.AppError
import momo.api.usecases.ListMatchesCommand

/** Query-parameter ↔ command conversion for `MatchesEndpoints.list`. */
object MatchListCodec:
  def toListCommand(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      status: Option[String],
      kind: Option[String],
      limit: Option[Int],
      page: Option[Int],
      pageSize: Option[Int],
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
      limit = limit,
      page = page,
      pageSize = pageSize,
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

  private def parseStatus(status: Option[String]): Either[AppError, MatchListStatusFilter] =
    status match
      case None | Some("all") => Right(MatchListStatusFilter.All)
      case Some("incomplete") => Right(MatchListStatusFilter.Incomplete)
      case Some("ocr_running") => Right(MatchListStatusFilter.OcrRunning)
      case Some("pre_confirm") => Right(MatchListStatusFilter.PreConfirm)
      case Some("needs_review") => Right(MatchListStatusFilter.NeedsReview)
      case Some("confirmed") => Right(MatchListStatusFilter.Confirmed)
      case Some(other) => Left(AppError.ValidationFailed(
          s"status must be all, incomplete, ocr_running, pre_confirm, needs_review, or confirmed: $other"
        ))

  private def parseKind(kind: Option[String]): Either[AppError, MatchListKindFilter] = kind match
    case None => Right(MatchListKindFilter.All)
    case Some("match") => Right(MatchListKindFilter.Match)
    case Some("match_draft") => Right(MatchListKindFilter.MatchDraft)
    case Some(other) =>
      Left(AppError.ValidationFailed(s"kind must be match or match_draft: $other"))

  private def parseSort(sort: Option[String]): Either[AppError, MatchListSort] = sort match
    case None | Some("status_priority") => Right(MatchListSort.StatusPriority)
    case Some("updated_desc") => Right(MatchListSort.UpdatedDesc)
    case Some("held_desc") => Right(MatchListSort.HeldDesc)
    case Some("held_asc") => Right(MatchListSort.HeldAsc)
    case Some("match_no_asc") => Right(MatchListSort.MatchNoAsc)
    case Some(other) => Left(AppError.ValidationFailed(
        s"sort must be status_priority, updated_desc, held_desc, held_asc, or match_no_asc: $other"
      ))
end MatchListCodec
