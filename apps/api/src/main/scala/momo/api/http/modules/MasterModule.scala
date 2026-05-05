package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.GameTitleId
import momo.api.endpoints.codec.MasterCodec
import momo.api.endpoints.{
  CreateGameTitleRequest, CreateMapMasterRequest, CreateSeasonMasterRequest, GameTitleListResponse,
  GameTitleResponse, GameTitlesEndpoints, IncidentMasterListResponse, IncidentMasterResponse,
  IncidentMastersEndpoints, MapMasterListResponse, MapMasterResponse, MapMastersEndpoints,
  SeasonMasterListResponse, SeasonMasterResponse, SeasonMastersEndpoints,
}
import momo.api.http.{EndpointSecurity, IdempotencyHandler}
import momo.api.repositories.{
  GameTitlesRepository, IdempotencyRepository, IncidentMastersRepository, MapMastersRepository,
  SeasonMastersRepository,
}
import momo.api.usecases.{CreateGameTitle, CreateMapMaster, CreateSeasonMaster}

object MasterModule:
  def routes[F[_]: Async](
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    GameTitlesEndpoints.list.serverLogic { devUser =>
      security.authorizeRead(devUser) { _ =>
        gameTitles.list
          .map(items => Right(GameTitleListResponse(items.map(GameTitleResponse.from))))
      }
    },
    GameTitlesEndpoints.create.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, CreateGameTitleRequest, GameTitleResponse](
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
    MapMastersEndpoints.list.serverLogic { case (gameTitleId, devUser) =>
      security.authorizeRead(devUser) { _ =>
        mapMasters.list(gameTitleId.map(GameTitleId(_)))
          .map(items => Right(MapMasterListResponse(items.map(MapMasterResponse.from))))
      }
    },
    MapMastersEndpoints.create.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, CreateMapMasterRequest, MapMasterResponse](
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
    SeasonMastersEndpoints.list.serverLogic { case (gameTitleId, devUser) =>
      security.authorizeRead(devUser) { _ =>
        seasonMasters.list(gameTitleId.map(GameTitleId(_)))
          .map(items => Right(SeasonMasterListResponse(items.map(SeasonMasterResponse.from))))
      }
    },
    SeasonMastersEndpoints.create.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, CreateSeasonMasterRequest, SeasonMasterResponse](
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
    IncidentMastersEndpoints.list.serverLogic { devUser =>
      security.authorizeRead(devUser) { _ =>
        incidentMasters.list
          .map(items => Right(IncidentMasterListResponse(items.map(IncidentMasterResponse.from))))
      }
    },
  )
