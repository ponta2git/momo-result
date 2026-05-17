package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.endpoints.{
  CreateGameTitleRequest, CreateMapMasterRequest, CreateMemberAliasRequest,
  CreateSeasonMasterRequest, UpdateGameTitleRequest, UpdateMapMasterRequest,
  UpdateMemberAliasRequest, UpdateSeasonMasterRequest,
}
import momo.api.errors.AppError
import momo.api.usecases.{
  CreateGameTitleCommand, CreateMapMasterCommand, CreateMemberAliasCommand,
  CreateSeasonMasterCommand, UpdateGameTitleCommand, UpdateMapMasterCommand,
  UpdateMemberAliasCommand, UpdateSeasonMasterCommand,
}

/** DTO ↔ usecase command conversions for master-data endpoints. */
object MasterCodec:
  def toCreateGameTitleCommand(
      request: CreateGameTitleRequest
  ): Either[AppError, CreateGameTitleCommand] = BoundaryId
    .required("id", request.id)(GameTitleId.fromString)
    .map(id => CreateGameTitleCommand(id, request.name, request.layoutFamily))

  def toCreateMapMasterCommand(
      request: CreateMapMasterRequest
  ): Either[AppError, CreateMapMasterCommand] =
    for
      id <- BoundaryId.required("id", request.id)(MapMasterId.fromString)
      gameTitleId <- BoundaryId.required("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
    yield CreateMapMasterCommand(id, gameTitleId, request.name)

  def toCreateSeasonMasterCommand(
      request: CreateSeasonMasterRequest
  ): Either[AppError, CreateSeasonMasterCommand] =
    for
      id <- BoundaryId.required("id", request.id)(SeasonMasterId.fromString)
      gameTitleId <- BoundaryId.required("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
    yield CreateSeasonMasterCommand(id, gameTitleId, request.name)

  def toUpdateGameTitleCommand(
      id: String,
      request: UpdateGameTitleRequest,
  ): Either[AppError, UpdateGameTitleCommand] = BoundaryId
    .required("id", id)(GameTitleId.fromString)
    .map(UpdateGameTitleCommand(_, request.name, request.layoutFamily))

  def toUpdateMapMasterCommand(
      id: String,
      request: UpdateMapMasterRequest,
  ): Either[AppError, UpdateMapMasterCommand] = BoundaryId
    .required("id", id)(MapMasterId.fromString).map(UpdateMapMasterCommand(_, request.name))

  def toUpdateSeasonMasterCommand(
      id: String,
      request: UpdateSeasonMasterRequest,
  ): Either[AppError, UpdateSeasonMasterCommand] = BoundaryId
    .required("id", id)(SeasonMasterId.fromString).map(UpdateSeasonMasterCommand(_, request.name))

  def toCreateMemberAliasCommand(
      request: CreateMemberAliasRequest
  ): Either[AppError, CreateMemberAliasCommand] = BoundaryId
    .required("memberId", request.memberId)(MemberId.fromString)
    .map(memberId => CreateMemberAliasCommand(memberId, request.alias))

  def toUpdateMemberAliasCommand(
      id: String,
      request: UpdateMemberAliasRequest,
  ): Either[AppError, UpdateMemberAliasCommand] =
    for
      parsedId <- BoundaryId.nonBlank("id", id)
      memberId <- BoundaryId.required("memberId", request.memberId)(MemberId.fromString)
    yield UpdateMemberAliasCommand(parsedId, memberId, request.alias)
end MasterCodec
