package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import java.time.format.DateTimeFormatter
import java.time.Instant
import momo.api.auth.{
  CsrfTokenService, DiscordOAuthClient, LoginRateLimiter, MemberRoster, OAuthStateCodec,
  SessionService,
}
import momo.api.config.AppConfig
import momo.api.domain.OcrJobHints
import momo.api.endpoints.{
  CancelMatchDraftResponse, CancelOcrJobResponse, ConfirmMatchRequest, ConfirmMatchResponse,
  CreateOcrJobResponse, DeleteMatchResponse, ExportEndpoints, GameTitleListResponse,
  GameTitleResponse, GameTitlesEndpoints, HealthEndpoints, HeldEventListResponse, HeldEventResponse,
  HeldEventsEndpoints, IncidentMasterListResponse, IncidentMasterResponse, IncidentMastersEndpoints,
  MapMasterListResponse, MapMasterResponse, MapMastersEndpoints, MatchDetailResponse,
  MatchDraftEndpoints, MatchDraftResponse, MatchDraftSourceImageListResponse,
  MatchDraftSourceImageResponse, MatchListResponse, MatchSummaryResponse, MatchesEndpoints,
  OcrDraftEndpoints, OcrDraftListResponse, OcrDraftResponse, OcrJobEndpoints, OcrJobResponse,
  OpenApiEndpoints, SeasonMasterListResponse, SeasonMasterResponse, SeasonMastersEndpoints,
  UpdateMatchRequest, UploadEndpoints, UploadImageResponse,
}
import momo.api.errors.AppError
import momo.api.openapi.OpenApiGenerator
import momo.api.repositories.{
  GameTitlesRepository, IncidentMastersRepository, MapMastersRepository, MembersRepository,
  SeasonMastersRepository,
}
import momo.api.usecases.{
  CancelMatchDraft, CancelOcrJob, ConfirmMatch, CreateGameTitle, CreateGameTitleCommand,
  CreateHeldEvent, CreateHeldEventCommand, CreateMapMaster, CreateMapMasterCommand,
  CreateMatchDraft, CreateMatchDraftCommand, CreateOcrJob, CreateOcrJobCommand, CreateSeasonMaster,
  CreateSeasonMasterCommand, DeleteMatch, ExportMatches, GetMatch, GetMatchDraftSourceImages,
  GetOcrDraft, GetOcrDraftsBulk, GetOcrJob, ListHeldEvents, ListMatches, ListMatchesCommand,
  UpdateMatch, UpdateMatchDraft, UpdateMatchDraftCommand, UploadImage,
}
import org.http4s.{HttpApp as Http4sApp, HttpRoutes as Http4sRoutes}
import org.http4s.server.Router
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
      createMatchDraft: CreateMatchDraft[F],
      updateMatchDraft: UpdateMatchDraft[F],
      cancelMatchDraft: CancelMatchDraft[F],
      getMatchDraftSourceImages: GetMatchDraftSourceImages[F],
      confirmMatch: ConfirmMatch[F],
      exportMatches: ExportMatches[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      deleteMatch: DeleteMatch[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F],
      members: MembersRepository[F],
      oauthClient: DiscordOAuthClient[F],
      sessionService: SessionService[F],
      csrfTokenService: CsrfTokenService,
      oauthStateCodec: OAuthStateCodec[F],
      loginRateLimiter: LoginRateLimiter[F],
  )

  def routes[F[_]: Async](deps: Dependencies[F]): Http4sApp[F] =
    val security = EndpointSecurity[F](deps.config, deps.roster)

    def toProblem(error: AppError): ProblemDetails.ErrorInfo = ProblemDetails.from(error)

    def respond[A, B](result: F[Either[AppError, A]])(
        onSuccess: A => B
    ): F[Either[ProblemDetails.ErrorInfo, B]] = result.map(_.leftMap(toProblem).map(onSuccess))

    val tapirRoutes = Http4sServerInterpreter[F]().toRoutes(List[ServerEndpoint[Any, F]](
      HealthEndpoints.health
        .serverLogicSuccess(_ => Async[F].pure(HealthEndpoints.HealthResponse("ok"))),
      OpenApiEndpoints.yaml.serverLogicSuccess(_ => Async[F].pure(OpenApiGenerator.yaml)),
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
            matchDraftId = request.matchDraftId,
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
      MatchDraftEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { member =>
          parseInstantOption(request.playedAt).flatMap {
            case Left(error) => Async[F].pure(Left(toProblem(error)))
            case Right(playedAt) =>
              respond(deps.createMatchDraft.run(
                CreateMatchDraftCommand(
                  heldEventId = request.heldEventId,
                  matchNoInEvent = request.matchNoInEvent,
                  gameTitleId = request.gameTitleId,
                  layoutFamily = request.layoutFamily,
                  seasonMasterId = request.seasonMasterId,
                  ownerMemberId = request.ownerMemberId,
                  mapMasterId = request.mapMasterId,
                  playedAt = playedAt,
                  status = request.status,
                ),
                member.memberId,
              ))(MatchDraftResponse.from)
          }
        }
      },
      MatchDraftEndpoints.update.serverLogic { case (draftId, devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { member =>
          parseInstantOption(request.playedAt).flatMap {
            case Left(error) => Async[F].pure(Left(toProblem(error)))
            case Right(playedAt) =>
              respond(deps.updateMatchDraft.run(
                draftId,
                UpdateMatchDraftCommand(
                  heldEventId = request.heldEventId,
                  matchNoInEvent = request.matchNoInEvent,
                  gameTitleId = request.gameTitleId,
                  layoutFamily = request.layoutFamily,
                  seasonMasterId = request.seasonMasterId,
                  ownerMemberId = request.ownerMemberId,
                  mapMasterId = request.mapMasterId,
                  playedAt = playedAt,
                  status = request.status,
                ),
                member.memberId,
              ))(MatchDraftResponse.from)
          }
        }
      },
      MatchDraftEndpoints.cancel.serverLogic { case (draftId, devUser, csrfToken) =>
        security.authorizeMutation(devUser, csrfToken) { member =>
          respond(
            deps.cancelMatchDraft.run(draftId, member.memberId)
          )(_ => CancelMatchDraftResponse(matchDraftId = draftId, status = "cancelled"))
        }
      },
      MatchDraftEndpoints.listSourceImages.serverLogic { case (draftId, devUser) =>
        security.authorizeRead(devUser) { member =>
          respond(deps.getMatchDraftSourceImages.list(draftId, member.memberId))(items =>
            MatchDraftSourceImageListResponse(items.map(MatchDraftSourceImageResponse.from))
          )
        }
      },
      MatchDraftEndpoints.getSourceImage.serverLogic { case (draftId, kind, devUser) =>
        security.authorizeRead(devUser) { member =>
          respond(
            deps.getMatchDraftSourceImages.stream(draftId, kind, member.memberId)
          )(image => ("private, no-store", "nosniff", image.bytes))
        }
      },
      ExportEndpoints.matches.serverLogic {
        case (format, seasonMasterId, heldEventId, matchId, devUser) => security
            .authorizeRead(devUser) { _ =>
              deps.exportMatches.run(format, seasonMasterId, heldEventId, matchId).map(
                _.leftMap(toProblem)
                  .map(file => (file.contentDisposition, file.contentType, file.body))
              )
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
      MatchesEndpoints.list.serverLogic {
        case (heldEventId, gameTitleId, seasonMasterId, status, kind, limit, devUser) => security
            .authorizeRead(devUser) { _ =>
              respond(deps.listMatches.run(ListMatchesCommand(
                heldEventId = heldEventId,
                gameTitleId = gameTitleId,
                seasonMasterId = seasonMasterId,
                status = status,
                kind = kind,
                limit = limit,
              )))(items => MatchListResponse(items.map(MatchSummaryResponse.from)))
            }
      },
      MatchesEndpoints.get.serverLogic { case (matchId, devUser) =>
        security.authorizeRead(devUser) { _ =>
          respond(deps.getMatch.run(matchId))(MatchDetailResponse.from)
        }
      },
      MatchesEndpoints.update.serverLogic { case (matchId, devUser, csrfToken, request) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(
            deps.updateMatch.run(matchId, toUpdateMatchCommand(request))
          )(MatchDetailResponse.from)
        }
      },
      MatchesEndpoints.delete.serverLogic { case (matchId, devUser, csrfToken) =>
        security.authorizeMutation(devUser, csrfToken) { _ =>
          respond(deps.deleteMatch.run(matchId))(_ => DeleteMatchResponse(matchId, deleted = true))
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

    val protectedRoutes =
      ProductionSessionMiddleware[F](deps.config, deps.sessionService, deps.csrfTokenService)(
        tapirRoutes.orNotFound
      )

    val authRoutes = AuthHttpRoutes.routes[F](
      config = deps.config,
      oauth = deps.oauthClient,
      stateCodec = deps.oauthStateCodec,
      sessions = deps.sessionService,
      csrf = deps.csrfTokenService,
      members = deps.members,
      rateLimiter = deps.loginRateLimiter,
    )

    RequestIdMiddleware[F](SecurityHeadersMiddleware[F](deps.config.appEnv)(
      Router("/" -> (authRoutes <+> Http4sRoutes.of[F](request => protectedRoutes.run(request))))
        .orNotFound
    ))

  private def toConfirmMatchCommand(request: ConfirmMatchRequest): ConfirmMatch.Command =
    ConfirmMatch.Command(
      heldEventId = request.heldEventId,
      matchNoInEvent = request.matchNoInEvent,
      gameTitleId = request.gameTitleId,
      seasonMasterId = request.seasonMasterId,
      ownerMemberId = request.ownerMemberId,
      mapMasterId = request.mapMasterId,
      playedAt = request.playedAt,
      matchDraftId = request.matchDraftId,
      draftRefs = ConfirmMatch.DraftRefs(
        totalAssets = request.draftIds.totalAssets,
        revenue = request.draftIds.revenue,
        incidentLog = request.draftIds.incidentLog,
      ),
      players = request.players.map(toPlayerResult),
    )

  private def toUpdateMatchCommand(request: UpdateMatchRequest): UpdateMatch.Command = UpdateMatch
    .Command(
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
      players = request.players.map(toPlayerResult),
    )

  private def toPlayerResult(
      player: momo.api.endpoints.PlayerResultRequest
  ): momo.api.domain.PlayerResult = momo.api.domain.PlayerResult(
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

  private def parseInstantOption[F[_]: Async](
      value: Option[String]
  ): F[Either[AppError, Option[Instant]]] = value match
    case None => Async[F].pure(Right(None))
    case Some(raw) => Either.catchOnly[Exception](Instant.parse(raw))
        .leftMap(_ => AppError.ValidationFailed("playedAt must be ISO8601 instant.")).map(Some(_))
        .pure[F]
