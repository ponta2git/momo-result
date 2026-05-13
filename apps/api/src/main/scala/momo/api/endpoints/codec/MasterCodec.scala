package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.endpoints.{
  CreateGameTitleRequest, CreateMapMasterRequest, CreateMemberAliasRequest,
  CreateSeasonMasterRequest, UpdateGameTitleRequest, UpdateMapMasterRequest,
  UpdateMemberAliasRequest, UpdateSeasonMasterRequest,
}
import momo.api.usecases.{
  CreateGameTitleCommand, CreateMapMasterCommand, CreateMemberAliasCommand,
  CreateSeasonMasterCommand, UpdateGameTitleCommand, UpdateMapMasterCommand,
  UpdateMemberAliasCommand, UpdateSeasonMasterCommand,
}

/** DTO ↔ usecase command conversions for master-data endpoints. */
object MasterCodec:
  def toCreateGameTitleCommand(request: CreateGameTitleRequest): CreateGameTitleCommand =
    CreateGameTitleCommand(
      GameTitleId.unsafeFromString(request.id),
      request.name,
      request.layoutFamily,
    )

  def toCreateMapMasterCommand(request: CreateMapMasterRequest): CreateMapMasterCommand =
    CreateMapMasterCommand(
      MapMasterId.unsafeFromString(request.id),
      GameTitleId.unsafeFromString(request.gameTitleId),
      request.name,
    )

  def toCreateSeasonMasterCommand(request: CreateSeasonMasterRequest): CreateSeasonMasterCommand =
    CreateSeasonMasterCommand(
      SeasonMasterId.unsafeFromString(request.id),
      GameTitleId.unsafeFromString(request.gameTitleId),
      request.name,
    )

  def toUpdateGameTitleCommand(
      id: String,
      request: UpdateGameTitleRequest,
  ): UpdateGameTitleCommand =
    UpdateGameTitleCommand(GameTitleId.unsafeFromString(id), request.name, request.layoutFamily)

  def toUpdateMapMasterCommand(
      id: String,
      request: UpdateMapMasterRequest,
  ): UpdateMapMasterCommand = UpdateMapMasterCommand(MapMasterId.unsafeFromString(id), request.name)

  def toUpdateSeasonMasterCommand(
      id: String,
      request: UpdateSeasonMasterRequest,
  ): UpdateSeasonMasterCommand =
    UpdateSeasonMasterCommand(SeasonMasterId.unsafeFromString(id), request.name)

  def toCreateMemberAliasCommand(request: CreateMemberAliasRequest): CreateMemberAliasCommand =
    CreateMemberAliasCommand(request.memberId, request.alias)

  def toUpdateMemberAliasCommand(
      id: String,
      request: UpdateMemberAliasRequest,
  ): UpdateMemberAliasCommand = UpdateMemberAliasCommand(id, request.memberId, request.alias)
end MasterCodec
