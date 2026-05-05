package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.endpoints.{
  CreateGameTitleRequest, CreateMapMasterRequest, CreateSeasonMasterRequest,
}
import momo.api.usecases.{
  CreateGameTitleCommand, CreateMapMasterCommand, CreateSeasonMasterCommand,
}

/** DTO ↔ usecase command conversions for master-data endpoints. */
object MasterCodec:
  def toCreateGameTitleCommand(request: CreateGameTitleRequest): CreateGameTitleCommand =
    CreateGameTitleCommand(GameTitleId(request.id), request.name, request.layoutFamily)

  def toCreateMapMasterCommand(request: CreateMapMasterRequest): CreateMapMasterCommand =
    CreateMapMasterCommand(MapMasterId(request.id), GameTitleId(request.gameTitleId), request.name)

  def toCreateSeasonMasterCommand(request: CreateSeasonMasterRequest): CreateSeasonMasterCommand =
    CreateSeasonMasterCommand(
      SeasonMasterId(request.id),
      GameTitleId(request.gameTitleId),
      request.name,
    )
end MasterCodec
