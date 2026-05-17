package momo.api.endpoints.codec

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.*
import momo.api.endpoints.{CreateMatchDraftRequest, UpdateMatchDraftRequest}
import momo.api.errors.AppError
import momo.api.usecases.{CreateMatchDraftCommand, UpdateMatchDraftCommand}

/** DTO ↔ usecase command conversions for `MatchDraftEndpoints`. */
object MatchDraftCodec:
  def parseInstantOption[F[_]: Async](value: Option[String]): F[Either[AppError, Option[Instant]]] =
    value match
      case None => Async[F].pure(Right(None))
      case Some(raw) => Either.catchOnly[Exception](Instant.parse(raw))
          .leftMap(_ => AppError.ValidationFailed("playedAt must be ISO8601 instant.")).map(Some(_))
          .pure[F]

  private def parseStatusOption(value: Option[String]): Either[AppError, Option[MatchDraftStatus]] =
    value match
      case None => Right(None)
      case Some(raw) =>
        MatchDraftStatus.fromWire(raw).map(Some(_)).toRight(AppError.ValidationFailed(
          s"status must be one of ocr_running, ocr_failed, draft_ready, needs_review, confirmed, cancelled: $raw"
        ))

  def toCreateCommand(
      request: CreateMatchDraftRequest,
      playedAt: Option[Instant],
  ): Either[AppError, CreateMatchDraftCommand] =
    for
      status <- parseStatusOption(request.status)
      heldEventId <- BoundaryId.optional("heldEventId", request.heldEventId)(HeldEventId.fromString)
      gameTitleId <- BoundaryId.optional("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
      seasonMasterId <- BoundaryId
        .optional("seasonMasterId", request.seasonMasterId)(SeasonMasterId.fromString)
      ownerMemberId <- BoundaryId
        .optional("ownerMemberId", request.ownerMemberId)(MemberId.fromString)
      mapMasterId <- BoundaryId.optional("mapMasterId", request.mapMasterId)(MapMasterId.fromString)
    yield CreateMatchDraftCommand(
      heldEventId = heldEventId,
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = gameTitleId,
      layoutFamily = request.layoutFamily,
      seasonMasterId = seasonMasterId,
      ownerMemberId = ownerMemberId,
      mapMasterId = mapMasterId,
      playedAt = playedAt,
      status = status,
    )

  def toUpdateCommand(
      request: UpdateMatchDraftRequest,
      playedAt: Option[Instant],
  ): Either[AppError, UpdateMatchDraftCommand] =
    for
      heldEventId <- BoundaryId.optional("heldEventId", request.heldEventId)(HeldEventId.fromString)
      gameTitleId <- BoundaryId.optional("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
      seasonMasterId <- BoundaryId
        .optional("seasonMasterId", request.seasonMasterId)(SeasonMasterId.fromString)
      ownerMemberId <- BoundaryId
        .optional("ownerMemberId", request.ownerMemberId)(MemberId.fromString)
      mapMasterId <- BoundaryId.optional("mapMasterId", request.mapMasterId)(MapMasterId.fromString)
      status <- parseStatusOption(request.status)
    yield UpdateMatchDraftCommand(
      heldEventId = heldEventId,
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = gameTitleId,
      layoutFamily = request.layoutFamily,
      seasonMasterId = seasonMasterId,
      ownerMemberId = ownerMemberId,
      mapMasterId = mapMasterId,
      playedAt = playedAt,
      status = status,
    )
end MatchDraftCodec
