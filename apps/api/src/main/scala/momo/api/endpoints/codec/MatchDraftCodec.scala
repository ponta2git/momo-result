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
  ): Either[AppError, CreateMatchDraftCommand] = parseStatusOption(request.status).map { status =>
    CreateMatchDraftCommand(
      heldEventId = request.heldEventId.map(HeldEventId(_)),
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = request.gameTitleId.map(GameTitleId(_)),
      layoutFamily = request.layoutFamily,
      seasonMasterId = request.seasonMasterId.map(SeasonMasterId(_)),
      ownerMemberId = request.ownerMemberId.map(MemberId(_)),
      mapMasterId = request.mapMasterId.map(MapMasterId(_)),
      playedAt = playedAt,
      status = status,
    )
  }

  def toUpdateCommand(
      request: UpdateMatchDraftRequest,
      playedAt: Option[Instant],
  ): UpdateMatchDraftCommand = UpdateMatchDraftCommand(
    heldEventId = request.heldEventId.map(HeldEventId(_)),
    matchNoInEvent = request.matchNoInEvent,
    gameTitleId = request.gameTitleId.map(GameTitleId(_)),
    layoutFamily = request.layoutFamily,
    seasonMasterId = request.seasonMasterId.map(SeasonMasterId(_)),
    ownerMemberId = request.ownerMemberId.map(MemberId(_)),
    mapMasterId = request.mapMasterId.map(MapMasterId(_)),
    playedAt = playedAt,
    status = request.status,
  )
end MatchDraftCodec
