package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}

final case class GameTitleResponse(
    id: String,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    createdAt: String,
) derives Codec.AsObject

object GameTitleResponse:
  def from(t: GameTitle): GameTitleResponse = GameTitleResponse(
    id = t.id.value,
    name = t.name,
    layoutFamily = t.layoutFamily,
    displayOrder = t.displayOrder,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(t.createdAt),
  )

final case class GameTitleListResponse(items: List[GameTitleResponse]) derives Codec.AsObject

final case class CreateGameTitleRequest(id: String, name: String, layoutFamily: String)
    derives Codec.AsObject

final case class UpdateGameTitleRequest(name: String, layoutFamily: String) derives Codec.AsObject

final case class MapMasterResponse(
    id: String,
    gameTitleId: String,
    name: String,
    displayOrder: Int,
    createdAt: String,
) derives Codec.AsObject

object MapMasterResponse:
  def from(m: MapMaster): MapMasterResponse = MapMasterResponse(
    id = m.id.value,
    gameTitleId = m.gameTitleId.value,
    name = m.name,
    displayOrder = m.displayOrder,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(m.createdAt),
  )

final case class MapMasterListResponse(items: List[MapMasterResponse]) derives Codec.AsObject

final case class CreateMapMasterRequest(id: String, gameTitleId: String, name: String)
    derives Codec.AsObject

final case class UpdateMapMasterRequest(name: String) derives Codec.AsObject

final case class SeasonMasterResponse(
    id: String,
    gameTitleId: String,
    name: String,
    displayOrder: Int,
    createdAt: String,
) derives Codec.AsObject

object SeasonMasterResponse:
  def from(s: SeasonMaster): SeasonMasterResponse = SeasonMasterResponse(
    id = s.id.value,
    gameTitleId = s.gameTitleId.value,
    name = s.name,
    displayOrder = s.displayOrder,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(s.createdAt),
  )

final case class SeasonMasterListResponse(items: List[SeasonMasterResponse]) derives Codec.AsObject

final case class CreateSeasonMasterRequest(id: String, gameTitleId: String, name: String)
    derives Codec.AsObject

final case class UpdateSeasonMasterRequest(name: String) derives Codec.AsObject

final case class IncidentMasterResponse(
    id: String,
    key: String,
    displayName: String,
    displayOrder: Int,
) derives Codec.AsObject

object IncidentMasterResponse:
  def from(i: IncidentMaster): IncidentMasterResponse = IncidentMasterResponse(
    id = i.id.value,
    key = i.key,
    displayName = i.displayName,
    displayOrder = i.displayOrder,
  )

final case class IncidentMasterListResponse(items: List[IncidentMasterResponse])
    derives Codec.AsObject

final case class MemberAliasResponse(id: String, memberId: String, alias: String, createdAt: String)
    derives Codec.AsObject

object MemberAliasResponse:
  def from(a: MemberAlias): MemberAliasResponse = MemberAliasResponse(
    id = a.id,
    memberId = a.memberId.value,
    alias = a.alias,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(a.createdAt),
  )

final case class MemberAliasListResponse(items: List[MemberAliasResponse]) derives Codec.AsObject

final case class CreateMemberAliasRequest(memberId: String, alias: String) derives Codec.AsObject

final case class UpdateMemberAliasRequest(memberId: String, alias: String) derives Codec.AsObject

final case class DeleteMasterResponse(id: String, deleted: Boolean) derives Codec.AsObject
