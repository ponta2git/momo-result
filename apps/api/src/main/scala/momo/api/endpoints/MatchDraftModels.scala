package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.MatchDraft
import momo.api.usecases.MatchDraftSourceImage

final case class CreateMatchDraftRequest(
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    layoutFamily: Option[String],
    seasonMasterId: Option[String],
    ownerMemberId: Option[String],
    mapMasterId: Option[String],
    playedAt: Option[String],
    status: Option[String],
) derives Codec.AsObject

final case class UpdateMatchDraftRequest(
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    layoutFamily: Option[String],
    seasonMasterId: Option[String],
    ownerMemberId: Option[String],
    mapMasterId: Option[String],
    playedAt: Option[String],
    status: Option[String],
) derives Codec.AsObject

final case class MatchDraftResponse(
    matchDraftId: String,
    status: String,
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object MatchDraftResponse:
  def from(draft: MatchDraft): MatchDraftResponse = MatchDraftResponse(
    matchDraftId = draft.id.value,
    status = draft.status.wire,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(draft.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(draft.updatedAt),
  )

final case class MatchDraftDetailResponse(
    matchDraftId: String,
    status: String,
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    seasonMasterId: Option[String],
    ownerMemberId: Option[String],
    mapMasterId: Option[String],
    playedAt: Option[String],
    totalAssetsDraftId: Option[String],
    revenueDraftId: Option[String],
    incidentLogDraftId: Option[String],
    totalAssetsImageId: Option[String],
    revenueImageId: Option[String],
    incidentLogImageId: Option[String],
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object MatchDraftDetailResponse:
  def from(draft: MatchDraft): MatchDraftDetailResponse = MatchDraftDetailResponse(
    matchDraftId = draft.id.value,
    status = draft.status.wire,
    heldEventId = draft.heldEventId.map(_.value),
    matchNoInEvent = draft.matchNoInEvent,
    gameTitleId = draft.gameTitleId.map(_.value),
    seasonMasterId = draft.seasonMasterId.map(_.value),
    ownerMemberId = draft.ownerMemberId.map(_.value),
    mapMasterId = draft.mapMasterId.map(_.value),
    playedAt = draft.playedAt.map(DateTimeFormatter.ISO_INSTANT.format),
    totalAssetsDraftId = draft.totalAssetsDraftId.map(_.value),
    revenueDraftId = draft.revenueDraftId.map(_.value),
    incidentLogDraftId = draft.incidentLogDraftId.map(_.value),
    totalAssetsImageId = draft.totalAssetsImageId.map(_.value),
    revenueImageId = draft.revenueImageId.map(_.value),
    incidentLogImageId = draft.incidentLogImageId.map(_.value),
    createdAt = DateTimeFormatter.ISO_INSTANT.format(draft.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(draft.updatedAt),
  )

final case class CancelMatchDraftResponse(matchDraftId: String, status: String)
    derives Codec.AsObject

final case class MatchDraftSourceImageResponse(
    kind: String,
    contentType: Option[String],
    createdAt: String,
    imageUrl: String,
) derives Codec.AsObject

object MatchDraftSourceImageResponse:
  def from(entry: MatchDraftSourceImage): MatchDraftSourceImageResponse =
    MatchDraftSourceImageResponse(
      kind = entry.kind.wire,
      contentType = entry.contentType,
      createdAt = DateTimeFormatter.ISO_INSTANT.format(entry.createdAt),
      imageUrl = entry.imageUrl,
    )

final case class MatchDraftSourceImageListResponse(items: List[MatchDraftSourceImageResponse])
    derives Codec.AsObject
