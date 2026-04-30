package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import java.time.format.DateTimeFormatter
import momo.api.auth.MemberRoster
import momo.api.config.AppConfig
import momo.api.domain.OcrJobHints
import momo.api.endpoints.{
  AuthEndpoints, AuthMeResponse, CancelOcrJobResponse, ConfirmMatchRequest, ConfirmMatchResponse,
  CreateOcrJobResponse, GameTitleListResponse, GameTitleResponse, GameTitlesEndpoints,
  HealthEndpoints, HeldEventListResponse, HeldEventResponse, HeldEventsEndpoints,
  IncidentMasterListResponse, IncidentMasterResponse, IncidentMastersEndpoints,
  MapMasterListResponse, MapMasterResponse, MapMastersEndpoints, MatchesEndpoints,
  OcrDraftEndpoints, OcrDraftListResponse, OcrDraftResponse, OcrJobEndpoints, OcrJobResponse,
  OpenApiEndpoints, SeasonMasterListResponse, SeasonMasterResponse, SeasonMastersEndpoints,
  UploadEndpoints, UploadImageResponse,
}
import momo.api.errors.AppError
import momo.api.openapi.OpenApiGenerator
import momo.api.repositories.{
  GameTitlesRepository, IncidentMastersRepository, MapMastersRepository, SeasonMastersRepository,
}
import momo.api.usecases.{
  CancelOcrJob, ConfirmMatch, CreateGameTitle, CreateGameTitleCommand, CreateHeldEvent,
  CreateHeldEventCommand, CreateMapMaster, CreateMapMasterCommand, CreateOcrJob,
  CreateOcrJobCommand, CreateSeasonMaster, CreateSeasonMasterCommand, GetOcrDraft, GetOcrDraftsBulk,
  GetOcrJob, ListHeldEvents, UploadImage,
}
import org.http4s.server.Router
import org.http4s.HttpApp as Http4sApp
import sttp.tapir.server.http4s.Http4sServerInterpreter
import sttp.tapir.server.ServerEndpoint

object HttpRoutes:
  final case class Dependencies[F[_]](
      config: AppConfig,
      roster: MemberRoster,
      uploadImage: UploadImage[F],
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      cancelOcrJob: CancelOcrJob[F],
      listHeldEvents: ListHeldEvents[F],
      createHeldEvent: CreateHeldEvent[F],
      confirmMatch: ConfirmMatch[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F],
  )

  def routes[F[_]: Async](deps: Dependencies[F]): Http4sApp[F] =
    val security = EndpointSecurity[F](deps.config, deps.roster)

    def toProblem(error: AppError): ProblemDetails.ErrorInfo = ProblemDetails.from(error)

    def respond[A, B](result: F[Either[AppError, A]])(
        onSuccess: A => B
    ): F[Either[ProblemDetails.ErrorInfo, B]] = result.map(_.leftMap(toProblem).map(onSuccess))

    val routes = Http4sServerInterpreter[F]().toRoutes(List[ServerEndpoint[Any, F]](
      HealthEndpoints.health
        .serverLogicSuccess(_ => Async[F].pure(HealthEndpoints.HealthResponse("ok"))),
      OpenApiEndpoints.yaml.serverLogicSuccess(_ => Async[F].pure(OpenApiGenerator.yaml)),
      AuthEndpoints.me.serverLogic { devUser =>
        security.authorizeRead(devUser)(member =>
          Async[F].pure(Right(AuthMeResponse(member.memberId.value, member.displayName)))
        )
      },
      UploadEndpoints.uploadImage.serverLogic { case (devUser, csrfToken, parts) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          MultipartUpload.file(parts) match
            case Left(error) => Async[F].pure(Left(toProblem(error)))
            case Right(upload) => respond(
                deps.uploadImage.run(upload.fileName, upload.contentType, upload.bytes)
              )(UploadImageResponse.from)
        }
      },
      OcrJobEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(deps.createOcrJob.run(CreateOcrJobCommand(
            imageId = request.imageId,
            requestedImageType = request.requestedImageType,
            ocrHints = request.ocrHints.getOrElse(OcrJobHints()),
          )))(created =>
            CreateOcrJobResponse(
              jobId = created.job.id.value,
              draftId = created.draft.id.value,
              status = created.job.status.wire,
            )
          )
        }
      },
      OcrJobEndpoints.get.serverLogic { case (jobId, devUser) =>
        security
          .authorizeRead(devUser)(_ => respond(deps.getOcrJob.run(jobId))(OcrJobResponse.from))
      },
      OcrJobEndpoints.cancel.serverLogic { case (jobId, devUser, csrfToken) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(deps.cancelOcrJob.run(jobId))(_ => CancelOcrJobResponse(jobId, "cancelled"))
        }
      },
      OcrDraftEndpoints.get.serverLogic { case (draftId, devUser) =>
        security.authorizeRead(devUser)(_ =>
          respond(deps.getOcrDraft.run(draftId))(OcrDraftResponse.from)
        )
      },
      OcrDraftEndpoints.listByIds.serverLogic { case (ids, devUser) =>
        security.authorizeRead(devUser) { _ =>
          respond(
            deps.getOcrDraftsBulk.run(ids)
          )(items => OcrDraftListResponse(items.map(OcrDraftResponse.from)))
        }
      },
      HeldEventsEndpoints.list.serverLogic { case (q, limit, devUser) =>
        security.authorizeRead(devUser) { _ =>
          deps.listHeldEvents.run(q, limit).map(items =>
            Right(HeldEventListResponse(items.map((e, c) => HeldEventResponse.from(e, c))))
          )
        }
      },
      HeldEventsEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(
            deps.createHeldEvent.run(CreateHeldEventCommand(request.heldAt))
          )(event => HeldEventResponse.from(event, 0))
        }
      },
      MatchesEndpoints.confirm.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { member =>
          respond(deps.confirmMatch.run(toConfirmMatchCommand(request), member.memberId))(record =>
            ConfirmMatchResponse(
              matchId = record.id,
              heldEventId = record.heldEventId,
              matchNoInEvent = record.matchNoInEvent,
              createdAt = DateTimeFormatter.ISO_INSTANT.format(record.createdAt),
            )
          )
        }
      },
      GameTitlesEndpoints.list.serverLogic { devUser =>
        security.authorizeRead(devUser) { _ =>
          deps.gameTitles.list
            .map(items => Right(GameTitleListResponse(items.map(GameTitleResponse.from))))
        }
      },
      GameTitlesEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(
            deps.createGameTitle
              .run(CreateGameTitleCommand(request.id, request.name, request.layoutFamily))
          )(GameTitleResponse.from)
        }
      },
      MapMastersEndpoints.list.serverLogic { case (gameTitleId, devUser) =>
        security.authorizeRead(devUser) { _ =>
          deps.mapMasters.list(gameTitleId)
            .map(items => Right(MapMasterListResponse(items.map(MapMasterResponse.from))))
        }
      },
      MapMastersEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(
            deps.createMapMaster
              .run(CreateMapMasterCommand(request.id, request.gameTitleId, request.name))
          )(MapMasterResponse.from)
        }
      },
      SeasonMastersEndpoints.list.serverLogic { case (gameTitleId, devUser) =>
        security.authorizeRead(devUser) { _ =>
          deps.seasonMasters.list(gameTitleId)
            .map(items => Right(SeasonMasterListResponse(items.map(SeasonMasterResponse.from))))
        }
      },
      SeasonMastersEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(
            deps.createSeasonMaster
              .run(CreateSeasonMasterCommand(request.id, request.gameTitleId, request.name))
          )(SeasonMasterResponse.from)
        }
      },
      IncidentMastersEndpoints.list.serverLogic { devUser =>
        security.authorizeRead(devUser) { _ =>
          deps.incidentMasters.list
            .map(items => Right(IncidentMasterListResponse(items.map(IncidentMasterResponse.from))))
        }
      },
    ))

    Router("/" -> routes).orNotFound

  private def toConfirmMatchCommand(request: ConfirmMatchRequest): ConfirmMatch.Command =
    ConfirmMatch.Command(
      heldEventId = request.heldEventId,
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = request.gameTitleId,
      seasonMasterId = request.seasonMasterId,
      ownerMemberId = request.ownerMemberId,
      mapMasterId = request.mapMasterId,
      playedAt = request.playedAt,
      draftRefs = ConfirmMatch.DraftRefs(
        totalAssets = request.draftIds.totalAssets,
        revenue = request.draftIds.revenue,
        incidentLog = request.draftIds.incidentLog,
      ),
      players = request.players.map(player =>
        momo.api.domain.PlayerResult(
          memberId = player.memberId,
          playOrder = player.playOrder,
          rank = player.rank,
          totalAssetsManYen = player.totalAssetsManYen,
          revenueManYen = player.revenueManYen,
          incidents = momo.api.domain.IncidentCounts(
            destination = player.incidents.destination,
            plusStation = player.incidents.plusStation,
            minusStation = player.incidents.minusStation,
            cardStation = player.incidents.cardStation,
            cardShop = player.incidents.cardShop,
            suriNoGinji = player.incidents.suriNoGinji,
          ),
        )
      ),
    )
