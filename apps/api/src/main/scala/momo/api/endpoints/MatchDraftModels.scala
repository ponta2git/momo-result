package momo.api.endpoints

import io.circe.Codec
import java.time.format.DateTimeFormatter
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
    matchDraftId = draft.id,
    status = draft.status.wire,
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
