package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.GameTitleId
import momo.api.endpoints.codec.MasterCodec
import momo.api.endpoints.{
  CreateGameTitleRequest, CreateMapMasterRequest, CreateMemberAliasRequest,
  CreateSeasonMasterRequest, DeleteMasterResponse, GameTitleListResponse, GameTitleResponse,
  GameTitlesEndpoints, IncidentMasterListResponse, IncidentMasterResponse, IncidentMastersEndpoints,
  MapMasterListResponse, MapMasterResponse, MapMastersEndpoints, MemberAliasListResponse,
  MemberAliasResponse, MemberAliasesEndpoints, SeasonMasterListResponse, SeasonMasterResponse,
  SeasonMastersEndpoints,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{
  CreateGameTitle, CreateMapMaster, CreateMemberAlias, CreateSeasonMaster, DeleteGameTitle,
  DeleteMapMaster, DeleteMemberAlias, DeleteSeasonMaster, ListGameTitles, ListIncidentMasters,
  ListMapMasters, ListMemberAliases, ListSeasonMasters, UpdateGameTitle, UpdateMapMaster,
  UpdateMemberAlias, UpdateSeasonMaster,
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
      idempotency: IdempotencyRepository[F],
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
          "POST /api/game-titles",
          request,
          nowF,
          security.respond(
            createGameTitle.run(MasterCodec.toCreateGameTitleCommand(request))
          )(GameTitleResponse.from),
        )
      }
    },
    GameTitlesEndpoints.update.serverLogic { case (id, accountHeader, csrfToken, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          updateGameTitle.run(MasterCodec.toUpdateGameTitleCommand(id, request))
        )(GameTitleResponse.from)
      }
    },
    GameTitlesEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          deleteGameTitle.run(momo.api.domain.ids.GameTitleId.unsafeFromString(id))
        )(_ => DeleteMasterResponse(id, deleted = true))
      }
    },
    MapMastersEndpoints.list.serverLogic { case (gameTitleId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        listMapMasters.run(gameTitleId.map(GameTitleId.unsafeFromString(_)))
          .map(items => Right(MapMasterListResponse(items.map(MapMasterResponse.from))))
      }
    },
    MapMastersEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateMapMasterRequest, MapMasterResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/map-masters",
          request,
          nowF,
          security.respond(
            createMapMaster.run(MasterCodec.toCreateMapMasterCommand(request))
          )(MapMasterResponse.from),
        )
      }
    },
    MapMastersEndpoints.update.serverLogic { case (id, accountHeader, csrfToken, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          updateMapMaster.run(MasterCodec.toUpdateMapMasterCommand(id, request))
        )(MapMasterResponse.from)
      }
    },
    MapMastersEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          deleteMapMaster.run(momo.api.domain.ids.MapMasterId.unsafeFromString(id))
        )(_ => DeleteMasterResponse(id, deleted = true))
      }
    },
    SeasonMastersEndpoints.list.serverLogic { case (gameTitleId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        listSeasonMasters.run(gameTitleId.map(GameTitleId.unsafeFromString(_)))
          .map(items => Right(SeasonMasterListResponse(items.map(SeasonMasterResponse.from))))
      }
    },
    SeasonMastersEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateSeasonMasterRequest, SeasonMasterResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/season-masters",
          request,
          nowF,
          security.respond(
            createSeasonMaster.run(MasterCodec.toCreateSeasonMasterCommand(request))
          )(SeasonMasterResponse.from),
        )
      }
    },
    SeasonMastersEndpoints.update.serverLogic { case (id, accountHeader, csrfToken, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          updateSeasonMaster.run(MasterCodec.toUpdateSeasonMasterCommand(id, request))
        )(SeasonMasterResponse.from)
      }
    },
    SeasonMastersEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          deleteSeasonMaster.run(momo.api.domain.ids.SeasonMasterId.unsafeFromString(id))
        )(_ => DeleteMasterResponse(id, deleted = true))
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
        security.respond(
          listMemberAliases.run(memberId)
        )(items => MemberAliasListResponse(items.map(MemberAliasResponse.from)))
      }
    },
    MemberAliasesEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateMemberAliasRequest, MemberAliasResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/member-aliases",
          request,
          nowF,
          security.respond(
            createMemberAlias.run(MasterCodec.toCreateMemberAliasCommand(request))
          )(MemberAliasResponse.from),
        )
      }
    },
    MemberAliasesEndpoints.update.serverLogic { case (id, accountHeader, csrfToken, request) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          updateMemberAlias.run(MasterCodec.toUpdateMemberAliasCommand(id, request))
        )(MemberAliasResponse.from)
      }
    },
    MemberAliasesEndpoints.delete.serverLogic { case (id, accountHeader, csrfToken) =>
      security.authorizeMasterManagementMutation(accountHeader, csrfToken) { _ =>
        security.respond(deleteMemberAlias.run(id))(_ => DeleteMasterResponse(id, deleted = true))
      }
    },
  )
