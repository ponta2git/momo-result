package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.endpoints.codec.{BoundaryId, MasterCodec}
import momo.api.endpoints.{
  DeleteMasterResponse,
  GameTitleListResponse,
  GameTitleResponse,
  GameTitlesEndpoints,
  IncidentMasterListResponse,
  IncidentMasterResponse,
  IncidentMastersEndpoints,
  MapMasterListResponse,
  MapMasterResponse,
  MapMastersEndpoints,
  SeasonMasterListResponse,
  SeasonMasterResponse,
  SeasonMastersEndpoints
}
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.masters.{
  CreateGameTitle,
  CreateMapMaster,
  CreateSeasonMaster,
  DeleteGameTitle,
  DeleteMapMaster,
  DeleteSeasonMaster,
  ListGameTitles,
  ListIncidentMasters,
  ListMapMasters,
  ListSeasonMasters,
  UpdateGameTitle,
  UpdateMapMaster,
  UpdateSeasonMaster
}

object MasterModule:
  final case class UseCases[F[_]](
      listGameTitles: ListGameTitles[F],
      listMapMasters: ListMapMasters[F],
      listSeasonMasters: ListSeasonMasters[F],
      listIncidentMasters: ListIncidentMasters[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F],
      updateGameTitle: UpdateGameTitle[F],
      updateMapMaster: UpdateMapMaster[F],
      updateSeasonMaster: UpdateSeasonMaster[F],
      deleteGameTitle: DeleteGameTitle[F],
      deleteMapMaster: DeleteMapMaster[F],
      deleteSeasonMaster: DeleteSeasonMaster[F],
      aliases: MasterMemberAliasRoutes.UseCases[F],
  )

  def routes[F[_]: Async](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.readLogic(security, GameTitlesEndpoints.list) { _ => _ =>
        listGameTitles.run
          .map(items => Right(GameTitleListResponse(items.map(GameTitleResponse.from))))
      },
      SecuredEndpoint.adminMutationLogic(security, GameTitlesEndpoints.create) { member =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.CreateGameTitle,
              idemKey,
              member,
              request,
            )(
              MasterCodec.toCreateGameTitleCommand(request)
            )(command =>
              createGameTitle.run(command)
            )(
              GameTitleResponse.from
            )
        }
      },
      SecuredEndpoint.adminMutationLogic(security, GameTitlesEndpoints.update) { member =>
        {
          case (id, idemKey, request) =>
            execution.mutation(
              HttpOperation.UpdateGameTitle,
              idemKey,
              member,
              (id, request),
            )(
              MasterCodec.toUpdateGameTitleCommand(id, request)
            )(command =>
              updateGameTitle.run(command)
            )(
              GameTitleResponse.from
            )
        }
      },
      SecuredEndpoint.adminMutationLogic(security, GameTitlesEndpoints.delete) { member =>
        {
          case (id, idemKey) =>
            execution.mutation(
              HttpOperation.DeleteGameTitle,
              idemKey,
              member,
              id,
            )(
              BoundaryId.required("id", id)(GameTitleId.fromString)
            )(parsedId =>
              deleteGameTitle.run(parsedId)
            )(_ =>
              DeleteMasterResponse(id, deleted = true)
            )
        }
      },
      SecuredEndpoint.readLogic(security, MapMastersEndpoints.list) { _ => gameTitleId =>
        security.decode(BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)) {
          parsedGameTitleId =>
            listMapMasters.run(parsedGameTitleId)
              .map(items => Right(MapMasterListResponse(items.map(MapMasterResponse.from))))
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, MapMastersEndpoints.create) { member =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.CreateMapMaster,
              idemKey,
              member,
              request,
            )(
              MasterCodec.toCreateMapMasterCommand(request)
            )(command =>
              createMapMaster.run(command)
            )(
              MapMasterResponse.from
            )
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, MapMastersEndpoints.update) { member =>
        {
          case (id, idemKey, request) =>
            execution.mutation(
              HttpOperation.UpdateMapMaster,
              idemKey,
              member,
              (id, request),
            )(
              MasterCodec.toUpdateMapMasterCommand(id, request)
            )(command =>
              updateMapMaster.run(command)
            )(
              MapMasterResponse.from
            )
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, MapMastersEndpoints.delete) { member =>
        {
          case (id, idemKey) =>
            execution.mutation(
              HttpOperation.DeleteMapMaster,
              idemKey,
              member,
              id,
            )(
              BoundaryId.required("id", id)(MapMasterId.fromString)
            )(parsedId =>
              deleteMapMaster.run(parsedId)
            )(_ =>
              DeleteMasterResponse(id, deleted = true)
            )
        }
      },
      SecuredEndpoint.readLogic(security, SeasonMastersEndpoints.list) { _ => gameTitleId =>
        security.decode(BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)) {
          parsedGameTitleId =>
            listSeasonMasters.run(parsedGameTitleId)
              .map(items => Right(SeasonMasterListResponse(items.map(SeasonMasterResponse.from))))
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, SeasonMastersEndpoints.create) { member =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.CreateSeasonMaster,
              idemKey,
              member,
              request,
            )(
              MasterCodec.toCreateSeasonMasterCommand(request)
            )(command =>
              createSeasonMaster.run(command)
            )(
              SeasonMasterResponse.from
            )
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, SeasonMastersEndpoints.update) { member =>
        {
          case (id, idemKey, request) =>
            execution.mutation(
              HttpOperation.UpdateSeasonMaster,
              idemKey,
              member,
              (id, request),
            )(
              MasterCodec.toUpdateSeasonMasterCommand(id, request)
            )(command =>
              updateSeasonMaster.run(command)
            )(
              SeasonMasterResponse.from
            )
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, SeasonMastersEndpoints.delete) { member =>
        {
          case (id, idemKey) =>
            execution.mutation(
              HttpOperation.DeleteSeasonMaster,
              idemKey,
              member,
              id,
            )(
              BoundaryId.required("id", id)(SeasonMasterId.fromString)
            )(parsedId =>
              deleteSeasonMaster.run(parsedId)
            )(_ => DeleteMasterResponse(id, deleted = true))
        }
      },
      SecuredEndpoint.readLogic(security, IncidentMastersEndpoints.list) { _ => _ =>
        listIncidentMasters.run
          .map(items => Right(IncidentMasterListResponse(items.map(IncidentMasterResponse.from))))
      },
    ) ::: MasterMemberAliasRoutes.routes(aliases, context)
