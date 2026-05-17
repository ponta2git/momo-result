package momo.api.endpoints.codec

import java.time.Instant
import java.time.format.DateTimeParseException

import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{IncidentCounts, PlayerResult}
import momo.api.endpoints.{ConfirmMatchRequest, PlayerResultRequest, UpdateMatchRequest}
import momo.api.errors.AppError
import momo.api.usecases.{ConfirmMatch, UpdateMatch}

/** DTO ↔ usecase command conversions for `MatchesEndpoints`. */
object MatchCodec:
  private def parseInstant(field: String, value: String): Either[AppError, Instant] = Either
    .catchOnly[DateTimeParseException](Instant.parse(value))
    .leftMap(_ => AppError.ValidationFailed(s"$field must be ISO8601 instant."))

  def toPlayerResult(player: PlayerResultRequest): Either[AppError, PlayerResult.Input] = BoundaryId
    .required("players.memberId", player.memberId)(MemberId.fromString).map { memberId =>
      PlayerResult.Input(
        memberId = memberId,
        playOrder = player.playOrder,
        rank = player.rank,
        totalAssetsManYen = player.totalAssetsManYen,
        revenueManYen = player.revenueManYen,
        incidents = IncidentCounts.Input(
          destination = player.incidents.destination,
          plusStation = player.incidents.plusStation,
          minusStation = player.incidents.minusStation,
          cardStation = player.incidents.cardStation,
          cardShop = player.incidents.cardShop,
          suriNoGinji = player.incidents.suriNoGinji,
        ),
      )
    }

  def toConfirmCommand(request: ConfirmMatchRequest): Either[AppError, ConfirmMatch.Command] =
    for
      heldEventId <- BoundaryId.required("heldEventId", request.heldEventId)(HeldEventId.fromString)
      gameTitleId <- BoundaryId.required("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
      seasonMasterId <- BoundaryId
        .required("seasonMasterId", request.seasonMasterId)(SeasonMasterId.fromString)
      ownerMemberId <- BoundaryId
        .required("ownerMemberId", request.ownerMemberId)(MemberId.fromString)
      mapMasterId <- BoundaryId.required("mapMasterId", request.mapMasterId)(MapMasterId.fromString)
      matchDraftId <- BoundaryId
        .optional("matchDraftId", request.matchDraftId)(MatchDraftId.fromString)
      playedAt <- parseInstant("playedAt", request.playedAt)
      totalAssetsDraftId <- BoundaryId
        .optional("draftIds.totalAssets", request.draftIds.totalAssets)(OcrDraftId.fromString)
      revenueDraftId <- BoundaryId
        .optional("draftIds.revenue", request.draftIds.revenue)(OcrDraftId.fromString)
      incidentLogDraftId <- BoundaryId
        .optional("draftIds.incidentLog", request.draftIds.incidentLog)(OcrDraftId.fromString)
      players <- request.players.traverse(toPlayerResult)
    yield ConfirmMatch.Command(
      heldEventId = heldEventId,
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = gameTitleId,
      seasonMasterId = seasonMasterId,
      ownerMemberId = ownerMemberId,
      mapMasterId = mapMasterId,
      playedAt = playedAt,
      matchDraftId = matchDraftId,
      draftRefs = ConfirmMatch.DraftRefs(
        totalAssets = totalAssetsDraftId,
        revenue = revenueDraftId,
        incidentLog = incidentLogDraftId,
      ),
      players = players,
    )

  def toUpdateCommand(request: UpdateMatchRequest): Either[AppError, UpdateMatch.Command] =
    for
      heldEventId <- BoundaryId.required("heldEventId", request.heldEventId)(HeldEventId.fromString)
      gameTitleId <- BoundaryId.required("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
      seasonMasterId <- BoundaryId
        .required("seasonMasterId", request.seasonMasterId)(SeasonMasterId.fromString)
      ownerMemberId <- BoundaryId
        .required("ownerMemberId", request.ownerMemberId)(MemberId.fromString)
      mapMasterId <- BoundaryId.required("mapMasterId", request.mapMasterId)(MapMasterId.fromString)
      playedAt <- parseInstant("playedAt", request.playedAt)
      totalAssetsDraftId <- BoundaryId
        .optional("draftIds.totalAssets", request.draftIds.totalAssets)(OcrDraftId.fromString)
      revenueDraftId <- BoundaryId
        .optional("draftIds.revenue", request.draftIds.revenue)(OcrDraftId.fromString)
      incidentLogDraftId <- BoundaryId
        .optional("draftIds.incidentLog", request.draftIds.incidentLog)(OcrDraftId.fromString)
      players <- request.players.traverse(toPlayerResult)
    yield UpdateMatch.Command(
      heldEventId = heldEventId,
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = gameTitleId,
      seasonMasterId = seasonMasterId,
      ownerMemberId = ownerMemberId,
      mapMasterId = mapMasterId,
      playedAt = playedAt,
      draftRefs = ConfirmMatch.DraftRefs(
        totalAssets = totalAssetsDraftId,
        revenue = revenueDraftId,
        incidentLog = incidentLogDraftId,
      ),
      players = players,
    )
end MatchCodec
