package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.OcrDraftId

/** Validated edits; omitted OCR references keep the value current at the time of saving. */
final case class MatchUpdate(
    input: MatchRecord.ValidatedInput,
    layoutFamily: String,
    playedAt: Instant,
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
):
  def applyTo(current: MatchRecord): MatchRecord = current.copy(
    heldEventId = input.heldEventId,
    matchNoInEvent = input.matchNoInEvent,
    gameTitleId = input.gameTitleId,
    layoutFamily = layoutFamily,
    seasonMasterId = input.seasonMasterId,
    ownerMemberId = input.ownerMemberId,
    mapMasterId = input.mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = totalAssetsDraftId.orElse(current.totalAssetsDraftId),
    revenueDraftId = revenueDraftId.orElse(current.revenueDraftId),
    incidentLogDraftId = incidentLogDraftId.orElse(current.incidentLogDraftId),
    players = input.players,
  )
