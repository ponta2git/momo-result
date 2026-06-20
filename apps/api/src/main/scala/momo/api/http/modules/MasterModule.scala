package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{GameTitleId, MapMasterId, MemberAliasId, MemberId, SeasonMasterId}
import momo.api.endpoints.codec.{BoundaryId, MasterCodec}
import momo.api.endpoints.{
  CreateGameTitleRequest,
  CreateMapMasterRequest,
  CreateMemberAliasRequest,
  CreateSeasonMasterRequest,
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
  MemberAliasListResponse,
  MemberAliasResponse,
  MemberAliasesEndpoints,
  SeasonMasterListResponse,
  SeasonMasterResponse,
  SeasonMastersEndpoints,
  UpdateGameTitleRequest,
  UpdateMapMasterRequest,
  UpdateMemberAliasRequest,
  UpdateSeasonMasterRequest
}
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay}
import momo.api.usecases.{
  CreateGameTitle,
  CreateMapMaster,
  CreateMemberAlias,
  CreateSeasonMaster,
  DeleteGameTitle,
  DeleteMapMaster,
  DeleteMemberAlias,
  DeleteSeasonMaster,
  ListGameTitles,
  ListIncidentMasters,
  ListMapMasters,
  ListMemberAliases,
  ListSeasonMasters,
  UpdateGameTitle,
  UpdateMapMaster,
  UpdateMemberAlias,
  UpdateSeasonMaster
}

object MasterModule:
  def routes[F[_]: Async](
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
      listMemberAliases: ListMemberAliases[F],
      createMemberAlias: CreateMemberAlias[F],
      updateMemberAlias: UpdateMemberAlias[F],
      deleteMemberAlias: DeleteMemberAlias[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    GameTitlesEndpoints.list.serverLogic { accountHeader =>
      security.authorizeRead(accountHeader) { _ =>
        listGameTitles.run
          .map(items => Right(GameTitleListResponse(items.map(GameTitleResponse.from))))
      }
    },
    GameTitlesEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateGameTitleRequest, GameTitleResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.CreateGameTitle,
          request,
          nowF,
          security.decode(
            MasterCodec.toCreateGameTitleCommand(request)
          )(command => security.respond(createGameTitle.run(command))(GameTitleResponse.from)),
        )
      }
    },
    GameTitlesEndpoints.update.serverLogic {
      case (id, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, (String, UpdateGameTitleRequest), GameTitleResponse](
              idempotency,
              idemKey,
              member,
              HttpOperation.UpdateGameTitle,
              (id, request),
              nowF,
              security.decode(
                MasterCodec.toUpdateGameTitleCommand(id, request)
              )(command => security.respond(updateGameTitle.run(command))(GameTitleResponse.from)),
            )
          }
    },
    GameTitlesEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken, idemKey) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, DeleteMasterResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.DeleteGameTitle,
          id,
          nowF,
          security.decode(BoundaryId.required("id", id)(GameTitleId.fromString))(parsedId =>
            security
              .respond(deleteGameTitle.run(parsedId))(_ => DeleteMasterResponse(id, deleted = true))
          ),
        )
      }
    },
    MapMastersEndpoints.list.serverLogic { case (gameTitleId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        security.decode(BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)) {
          parsedGameTitleId =>
            listMapMasters.run(parsedGameTitleId)
              .map(items => Right(MapMasterListResponse(items.map(MapMasterResponse.from))))
        }
      }
    },
    MapMastersEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateMapMasterRequest, MapMasterResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.CreateMapMaster,
          request,
          nowF,
          security.decode(
            MasterCodec.toCreateMapMasterCommand(request)
          )(command => security.respond(createMapMaster.run(command))(MapMasterResponse.from)),
        )
      }
    },
    MapMastersEndpoints.update.serverLogic {
      case (id, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, (String, UpdateMapMasterRequest), MapMasterResponse](
              idempotency,
              idemKey,
              member,
              HttpOperation.UpdateMapMaster,
              (id, request),
              nowF,
              security.decode(
                MasterCodec.toUpdateMapMasterCommand(id, request)
              )(command => security.respond(updateMapMaster.run(command))(MapMasterResponse.from)),
            )
          }
    },
    MapMastersEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken, idemKey) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, DeleteMasterResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.DeleteMapMaster,
          id,
          nowF,
          security.decode(BoundaryId.required("id", id)(MapMasterId.fromString))(parsedId =>
            security
              .respond(deleteMapMaster.run(parsedId))(_ => DeleteMasterResponse(id, deleted = true))
          ),
        )
      }
    },
    SeasonMastersEndpoints.list.serverLogic { case (gameTitleId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        security.decode(BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)) {
          parsedGameTitleId =>
            listSeasonMasters.run(parsedGameTitleId)
              .map(items => Right(SeasonMasterListResponse(items.map(SeasonMasterResponse.from))))
        }
      }
    },
    SeasonMastersEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateSeasonMasterRequest, SeasonMasterResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.CreateSeasonMaster,
          request,
          nowF,
          security.decode(
            MasterCodec.toCreateSeasonMasterCommand(request)
          )(command =>
            security.respond(createSeasonMaster.run(command))(SeasonMasterResponse.from)
          ),
        )
      }
    },
    SeasonMastersEndpoints.update.serverLogic {
      case (id, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, (String, UpdateSeasonMasterRequest), SeasonMasterResponse](
              idempotency,
              idemKey,
              member,
              HttpOperation.UpdateSeasonMaster,
              (id, request),
              nowF,
              security.decode(MasterCodec.toUpdateSeasonMasterCommand(id, request))(command =>
                security.respond(updateSeasonMaster.run(command))(SeasonMasterResponse.from)
              ),
            )
          }
    },
    SeasonMastersEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken, idemKey) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, DeleteMasterResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.DeleteSeasonMaster,
          id,
          nowF,
          security.decode(BoundaryId.required("id", id)(SeasonMasterId.fromString))(parsedId =>
            security.respond(
              deleteSeasonMaster.run(parsedId)
            )(_ => DeleteMasterResponse(id, deleted = true))
          ),
        )
      }
    },
    IncidentMastersEndpoints.list.serverLogic { accountHeader =>
      security.authorizeRead(accountHeader) { _ =>
        listIncidentMasters.run
          .map(items => Right(IncidentMasterListResponse(items.map(IncidentMasterResponse.from))))
      }
    },
    MemberAliasesEndpoints.list.serverLogic { case (memberId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        security
          .decode(BoundaryId.optional("memberId", memberId)(MemberId.fromString)) { parsedMemberId =>
            security.respond(
              listMemberAliases.run(parsedMemberId)
            )(items => MemberAliasListResponse(items.map(MemberAliasResponse.from)))
          }
      }
    },
    MemberAliasesEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateMemberAliasRequest, MemberAliasResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.CreateMemberAlias,
          request,
          nowF,
          security.decode(
            MasterCodec.toCreateMemberAliasCommand(request)
          )(command => security.respond(createMemberAlias.run(command))(MemberAliasResponse.from)),
        )
      }
    },
    MemberAliasesEndpoints.update.serverLogic {
      case (id, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, (String, UpdateMemberAliasRequest), MemberAliasResponse](
              idempotency,
              idemKey,
              member,
              HttpOperation.UpdateMemberAlias,
              (id, request),
              nowF,
              security.decode(MasterCodec.toUpdateMemberAliasCommand(id, request))(command =>
                security.respond(updateMemberAlias.run(command))(MemberAliasResponse.from)
              ),
            )
          }
    },
    MemberAliasesEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken, idemKey) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, DeleteMasterResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.DeleteMemberAlias,
          id,
          nowF,
          security.decode(BoundaryId.required("id", id)(MemberAliasId.fromString))(parsedId =>
            security.respond(
              deleteMemberAlias.run(parsedId)
            )(_ => DeleteMasterResponse(id, deleted = true))
          ),
        )
      }
    },
  )
