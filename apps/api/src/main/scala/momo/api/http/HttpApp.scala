package momo.api.http

import cats.effect.Async
import cats.effect.Resource
import cats.syntax.all.*
import momo.api.adapters.InMemoryGameTitlesRepository
import momo.api.adapters.InMemoryHeldEventsRepository
import momo.api.adapters.InMemoryIncidentMastersRepository
import momo.api.adapters.InMemoryMapMastersRepository
import momo.api.adapters.InMemoryMatchesRepository
import momo.api.adapters.InMemoryMemberAliasesRepository
import momo.api.adapters.InMemoryMembersRepository
import momo.api.adapters.InMemoryOcrDraftsRepository
import momo.api.adapters.InMemoryOcrJobsRepository
import momo.api.adapters.InMemoryQueueProducer
import momo.api.adapters.InMemorySeasonMastersRepository
import momo.api.adapters.LocalFsImageStore
import momo.api.auth.MemberRoster
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.domain.IdGenerator
import momo.api.repositories.GameTitlesRepository
import momo.api.repositories.HeldEventsRepository
import momo.api.repositories.IncidentMastersRepository
import momo.api.repositories.MapMastersRepository
import momo.api.repositories.MatchesRepository
import momo.api.repositories.OcrDraftsRepository
import momo.api.repositories.OcrJobsRepository
import momo.api.repositories.SeasonMastersRepository
import momo.api.repositories.doobie.DoobieGameTitlesRepository
import momo.api.repositories.doobie.DoobieHeldEventsRepository
import momo.api.repositories.doobie.DoobieIncidentMastersRepository
import momo.api.repositories.doobie.DoobieMapMastersRepository
import momo.api.repositories.doobie.DoobieMatchesRepository
import momo.api.repositories.doobie.DoobieOcrDraftsRepository
import momo.api.repositories.doobie.DoobieOcrJobsRepository
import momo.api.repositories.doobie.DoobieSeasonMastersRepository
import momo.api.domain.ids.*
import momo.api.endpoints.AuthEndpoints
import momo.api.endpoints.AuthMeResponse
import momo.api.endpoints.CancelOcrJobResponse
import momo.api.endpoints.ConfirmMatchResponse
import momo.api.endpoints.CreateOcrJobResponse
import momo.api.endpoints.GameTitleListResponse
import momo.api.endpoints.GameTitleResponse
import momo.api.endpoints.GameTitlesEndpoints
import momo.api.endpoints.HealthEndpoints
import momo.api.endpoints.HeldEventListResponse
import momo.api.endpoints.HeldEventResponse
import momo.api.endpoints.HeldEventsEndpoints
import momo.api.endpoints.IncidentCountsResponse
import momo.api.endpoints.IncidentMasterListResponse
import momo.api.endpoints.IncidentMasterResponse
import momo.api.endpoints.IncidentMastersEndpoints
import momo.api.endpoints.MapMasterListResponse
import momo.api.endpoints.MapMasterResponse
import momo.api.endpoints.MapMastersEndpoints
import momo.api.endpoints.MatchesEndpoints
import momo.api.endpoints.OcrDraftEndpoints
import momo.api.endpoints.OcrDraftListResponse
import momo.api.endpoints.OcrDraftResponse
import momo.api.endpoints.OcrJobEndpoints
import momo.api.endpoints.OcrJobResponse
import momo.api.endpoints.OpenApiEndpoints
import momo.api.endpoints.PlayerResultResponse
import momo.api.endpoints.SeasonMasterListResponse
import momo.api.endpoints.SeasonMasterResponse
import momo.api.endpoints.SeasonMastersEndpoints
import momo.api.endpoints.UploadEndpoints
import momo.api.endpoints.UploadImageResponse
import momo.api.errors.AppError
import momo.api.openapi.OpenApiGenerator
import momo.api.usecases.CancelOcrJob
import momo.api.usecases.ConfirmMatch
import momo.api.usecases.CreateGameTitle
import momo.api.usecases.CreateGameTitleCommand
import momo.api.usecases.CreateHeldEvent
import momo.api.usecases.CreateHeldEventCommand
import momo.api.usecases.CreateMapMaster
import momo.api.usecases.CreateMapMasterCommand
import momo.api.usecases.CreateOcrJob
import momo.api.usecases.CreateOcrJobCommand
import momo.api.usecases.CreateSeasonMaster
import momo.api.usecases.CreateSeasonMasterCommand
import momo.api.usecases.GetOcrDraft
import momo.api.usecases.GetOcrDraftsBulk
import momo.api.usecases.GetOcrJob
import momo.api.usecases.ListHeldEvents
import momo.api.usecases.UploadImage
import org.http4s.HttpApp as Http4sApp
import org.http4s.server.Router
import sttp.model.Part
import sttp.tapir.server.ServerEndpoint
import sttp.tapir.server.http4s.Http4sServerInterpreter

import java.time.Instant

object HttpApp:
  /** Test-only handle so specs can seed master tables without exposing
    * real HTTP master endpoints (those land in section D).
    */
  final case class Wired[F[_]](
      app: Http4sApp[F],
      gameTitles: momo.api.repositories.GameTitlesRepository[F],
      mapMasters: momo.api.repositories.MapMastersRepository[F],
      seasonMasters: momo.api.repositories.SeasonMastersRepository[F]
  )

  def resource[F[_]: Async](config: AppConfig): Resource[F, Http4sApp[F]] =
    wired[F](config).map(_.app)

  /** Build all dependencies. When `config.database` is set we use Doobie
    * repositories backed by HikariCP; otherwise we wire up InMemory adapters
    * (used by tests and the early dev environment).
    */
  def wired[F[_]: Async](config: AppConfig): Resource[F, Wired[F]] =
    config.database match
      case Some(db) =>
        Database.transactor[F](db).evalMap { xa =>
          for
            queue <- InMemoryQueueProducer.create[F]
          yield
            val jobs: OcrJobsRepository[F] = DoobieOcrJobsRepository[F](xa)
            val drafts: OcrDraftsRepository[F] = DoobieOcrDraftsRepository[F](xa)
            val heldEvents: HeldEventsRepository[F] = DoobieHeldEventsRepository[F](xa)
            val matches: MatchesRepository[F] = DoobieMatchesRepository[F](xa)
            val gameTitles: GameTitlesRepository[F] = DoobieGameTitlesRepository[F](xa)
            val mapMasters: MapMastersRepository[F] = DoobieMapMastersRepository[F](xa)
            val seasonMasters: SeasonMastersRepository[F] =
              DoobieSeasonMastersRepository[F](xa)
            val incidentMasters: IncidentMastersRepository[F] =
              DoobieIncidentMastersRepository[F](xa)
            assemble(
              config = config,
              queue = queue,
              jobs = jobs,
              drafts = drafts,
              heldEvents = heldEvents,
              matches = matches,
              gameTitles = gameTitles,
              mapMasters = mapMasters,
              seasonMasters = seasonMasters,
              incidentMasters = incidentMasters
            )
        }
      case None =>
        Resource.eval {
          for
            jobs <- InMemoryOcrJobsRepository.create[F]
            drafts <- InMemoryOcrDraftsRepository.create[F]
            queue <- InMemoryQueueProducer.create[F]
            heldEvents <- InMemoryHeldEventsRepository.create[F]
            matches <- InMemoryMatchesRepository.create[F]
            gameTitles <- InMemoryGameTitlesRepository.create[F]
            mapMasters <- InMemoryMapMastersRepository.create[F]
            seasonMasters <- InMemorySeasonMastersRepository.create[F]
            incidentMasters <- InMemoryIncidentMastersRepository.create[F]
          yield assemble(
            config = config,
            queue = queue,
            jobs = jobs,
            drafts = drafts,
            heldEvents = heldEvents,
            matches = matches,
            gameTitles = gameTitles,
            mapMasters = mapMasters,
            seasonMasters = seasonMasters,
            incidentMasters = incidentMasters
          )
        }

  private def assemble[F[_]: Async](
      config: AppConfig,
      queue: momo.api.repositories.QueueProducer[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      heldEvents: HeldEventsRepository[F],
      matches: MatchesRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F]
  ): Wired[F] =
    val imageStore = LocalFsImageStore[F](config.imageTmpDir)
    val roster = MemberRoster.dev(config.devMemberIds)
    val uploadImage = UploadImage[F](imageStore)
    val nowF = Async[F].delay(Instant.now())
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStore,
      jobs = jobs,
      drafts = drafts,
      queue = queue,
      now = nowF,
      nextId = IdGenerator.uuidV7[F]
    )
    val getOcrJob = GetOcrJob[F](jobs)
    val getOcrDraft = GetOcrDraft[F](drafts)
    val getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts)
    val cancelOcrJob = CancelOcrJob[F](jobs, nowF)
    val listHeldEvents = ListHeldEvents[F](heldEvents, matches)
    val createHeldEvent = CreateHeldEvent[F](heldEvents, IdGenerator.uuidV7[F])
    val confirmMatch = ConfirmMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      nextId = IdGenerator.uuidV7[F],
      allowedMemberIds = config.devMemberIds.toSet
    )
    val createGameTitle = CreateGameTitle[F](gameTitles, nowF)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, nowF)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, nowF)

    val app = build(
      config = config,
      roster = roster,
      uploadImage = uploadImage,
      createOcrJob = createOcrJob,
      getOcrJob = getOcrJob,
      getOcrDraft = getOcrDraft,
      getOcrDraftsBulk = getOcrDraftsBulk,
      cancelOcrJob = cancelOcrJob,
      listHeldEvents = listHeldEvents,
      createHeldEvent = createHeldEvent,
      confirmMatch = confirmMatch,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      incidentMasters = incidentMasters,
      createGameTitle = createGameTitle,
      createMapMaster = createMapMaster,
      createSeasonMaster = createSeasonMaster
    )
    Wired(app, gameTitles, mapMasters, seasonMasters)

  private def build[F[_]: Async](
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
      gameTitles: momo.api.repositories.GameTitlesRepository[F],
      mapMasters: momo.api.repositories.MapMastersRepository[F],
      seasonMasters: momo.api.repositories.SeasonMastersRepository[F],
      incidentMasters: momo.api.repositories.IncidentMastersRepository[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F]
  ): Http4sApp[F] =
    def toProblem(error: AppError): ProblemDetails.ErrorInfo =
      ProblemDetails.from(error)

    def authenticate(
        devUser: Option[String]
    ): F[Either[ProblemDetails.ErrorInfo, momo.api.auth.AuthenticatedMember]] =
      devUser match
        case Some(value) =>
          DevAuthMiddleware.authenticate(config.appEnv, roster, value).map(_.leftMap(toProblem))
        case None =>
          Async[F].pure(Left(toProblem(AppError.Unauthorized())))

    def validateCsrf(token: Option[String]): F[Either[ProblemDetails.ErrorInfo, Unit]] =
      CsrfMiddleware.validate(config.appEnv, token).map(_.leftMap(toProblem))

    def authorizeMutation(devUser: Option[String], csrfToken: Option[String]) =
      for
        auth <- authenticate(devUser)
        csrf <- validateCsrf(csrfToken)
      yield for
        member <- auth
        _ <- csrf
      yield member

    def extractFile(
        parts: Seq[Part[Array[Byte]]]
    ): Either[AppError, (Option[String], Option[String], Array[Byte])] =
      parts
        .find(_.name == "file")
        .map(part => (part.fileName, part.contentType.map(_.toString), part.body))
        .toRight(AppError.ValidationFailed("Multipart field 'file' is required."))

    val healthRoutes = Http4sServerInterpreter[F]().toRoutes(
      List[ServerEndpoint[Any, F]](
        HealthEndpoints.health.serverLogicSuccess(_ =>
          Async[F].pure(HealthEndpoints.HealthResponse("ok"))
        ),
        OpenApiEndpoints.yaml.serverLogicSuccess(_ => Async[F].pure(OpenApiGenerator.yaml)),
        AuthEndpoints.me.serverLogic { devUser =>
          authenticate(devUser).map(
            _.map(member => AuthMeResponse(member.memberId.value, member.displayName))
          )
        },
        UploadEndpoints.uploadImage.serverLogic { case (devUser, csrfToken, parts) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              extractFile(parts) match
                case Left(error) => Async[F].pure(Left(toProblem(error)))
                case Right((fileName, contentType, bytes)) =>
                  uploadImage.run(fileName, contentType, bytes).map {
                    case Right(image) => Right(UploadImageResponse.from(image))
                    case Left(error)  => Left(toProblem(error))
                  }
          }
        },
        OcrJobEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              createOcrJob
                .run(
                  CreateOcrJobCommand(
                    imageId = request.imageId,
                    requestedImageType = request.requestedImageType,
                    ocrHints = request.ocrHints.getOrElse(momo.api.domain.OcrJobHints())
                  )
                )
                .map {
                  case Right(created) =>
                    Right(
                      CreateOcrJobResponse(
                        jobId = created.job.id.value,
                        draftId = created.draft.id.value,
                        status = created.job.status.wire
                      )
                    )
                  case Left(error) => Left(toProblem(error))
                }
          }
        },
        OcrJobEndpoints.get.serverLogic { case (jobId, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              getOcrJob.run(jobId).map {
                case Right(job)  => Right(OcrJobResponse.from(job))
                case Left(error) => Left(toProblem(error))
              }
          }
        },
        OcrJobEndpoints.cancel.serverLogic { case (jobId, devUser, csrfToken) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              cancelOcrJob.run(jobId).map {
                case Right(_)    => Right(CancelOcrJobResponse(jobId, "cancelled"))
                case Left(error) => Left(toProblem(error))
              }
          }
        },
        OcrDraftEndpoints.get.serverLogic { case (draftId, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              getOcrDraft.run(draftId).map {
                case Right(draft) => Right(OcrDraftResponse.from(draft))
                case Left(error)  => Left(toProblem(error))
              }
          }
        },
        OcrDraftEndpoints.listByIds.serverLogic { case (ids, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              getOcrDraftsBulk.run(ids).map {
                case Right(items) =>
                  Right(OcrDraftListResponse(items.map(OcrDraftResponse.from)))
                case Left(error) => Left(toProblem(error))
              }
          }
        },
        HeldEventsEndpoints.list.serverLogic { case (q, limit, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              listHeldEvents.run(q, limit).map { items =>
                Right(HeldEventListResponse(items.map((e, c) => HeldEventResponse.from(e, c))))
              }
          }
        },
        HeldEventsEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              createHeldEvent
                .run(CreateHeldEventCommand(request.heldAt))
                .map {
                  case Right(event) => Right(HeldEventResponse.from(event, 0))
                  case Left(error)  => Left(toProblem(error))
                }
          }
        },
        MatchesEndpoints.confirm.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(member) =>
              confirmMatch.run(request, member.memberId).map {
                case Right(record) =>
                  Right(
                    ConfirmMatchResponse(
                      matchId = record.id,
                      heldEventId = record.heldEventId,
                      matchNoInEvent = record.matchNoInEvent,
                      createdAt = java.time.format.DateTimeFormatter.ISO_INSTANT
                        .format(record.createdAt)
                    )
                  )
                case Left(error) => Left(toProblem(error))
              }
          }
        },
        GameTitlesEndpoints.list.serverLogic { devUser =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              gameTitles.list.map(items => Right(GameTitleListResponse(items.map(GameTitleResponse.from))))
          }
        },
        GameTitlesEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              createGameTitle
                .run(CreateGameTitleCommand(request.id, request.name, request.layoutFamily))
                .map {
                  case Right(t)    => Right(GameTitleResponse.from(t))
                  case Left(error) => Left(toProblem(error))
                }
          }
        },
        MapMastersEndpoints.list.serverLogic { case (gameTitleId, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              mapMasters.list(gameTitleId).map(items =>
                Right(MapMasterListResponse(items.map(MapMasterResponse.from)))
              )
          }
        },
        MapMastersEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              createMapMaster
                .run(CreateMapMasterCommand(request.id, request.gameTitleId, request.name))
                .map {
                  case Right(m)    => Right(MapMasterResponse.from(m))
                  case Left(error) => Left(toProblem(error))
                }
          }
        },
        SeasonMastersEndpoints.list.serverLogic { case (gameTitleId, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              seasonMasters.list(gameTitleId).map(items =>
                Right(SeasonMasterListResponse(items.map(SeasonMasterResponse.from)))
              )
          }
        },
        SeasonMastersEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              createSeasonMaster
                .run(CreateSeasonMasterCommand(request.id, request.gameTitleId, request.name))
                .map {
                  case Right(s)    => Right(SeasonMasterResponse.from(s))
                  case Left(error) => Left(toProblem(error))
                }
          }
        },
        IncidentMastersEndpoints.list.serverLogic { devUser =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              incidentMasters.list.map(items =>
                Right(IncidentMasterListResponse(items.map(IncidentMasterResponse.from)))
              )
          }
        }
      )
    )

    Router("/" -> healthRoutes).orNotFound
