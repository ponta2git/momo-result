package momo.api.http

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import org.http4s.HttpApp as Http4sApp
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.slf4j.Slf4jFactory

import momo.api.adapters.{
  InMemoryAppSessionsRepository, InMemoryGameTitlesRepository, InMemoryHeldEventsRepository,
  InMemoryIdempotencyRepository, InMemoryImageReferenceRepository,
  InMemoryIncidentMastersRepository, InMemoryMapMastersRepository,
  InMemoryMatchConfirmationRepository, InMemoryMatchDraftsRepository, InMemoryMatchListReadModel,
  InMemoryMatchesRepository, InMemoryMembersRepository, InMemoryOcrDraftsRepository,
  InMemoryOcrJobCreationRepository, InMemoryOcrJobMaintenanceRepository, InMemoryOcrJobsRepository,
  InMemoryQueueProducer, InMemorySeasonMastersRepository, LocalFsImageStore, RedisQueueProducer,
}
import momo.api.auth.{
  CsrfTokenService, DiscordOAuthClient, JavaDiscordOAuthClient, LoginRateLimiter, MemberRoster,
  OAuthStateCodec, SessionService,
}
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.domain.Member
import momo.api.domain.ids.*
import momo.api.endpoints.HealthEndpoints.HealthDetailsResponse
import momo.api.repositories.postgres.{
  PostgresAppSessionsRepository, PostgresGameTitlesRepository, PostgresHeldEventsRepository,
  PostgresIdempotencyRepository, PostgresImageReferenceRepository,
  PostgresIncidentMastersRepository, PostgresMapMastersRepository,
  PostgresMatchConfirmationRepository, PostgresMatchDraftsRepository, PostgresMatchListReadModel,
  PostgresMatchesRepository, PostgresMembersRepository, PostgresOcrDraftsRepository,
  PostgresOcrJobCreationRepository, PostgresOcrJobMaintenanceRepository, PostgresOcrJobsRepository,
  PostgresOcrQueueOutboxRepository, PostgresSeasonMastersRepository,
}
import momo.api.repositories.{
  AppSessionsRepository, GameTitlesRepository, HeldEventsRepository, IdempotencyRepository,
  ImageReferenceRepository, IncidentMastersRepository, MapMastersRepository,
  MatchConfirmationRepository, MatchDraftsRepository, MatchListReadModel, MatchesRepository,
  MembersRepository, OcrDraftsRepository, OcrJobCreationRepository, OcrJobMaintenanceRepository,
  OcrJobsRepository, QueueProducer, SeasonMastersRepository,
}
import momo.api.usecases.{
  CancelMatchDraft, CancelOcrJob, ConfirmMatch, CreateGameTitle, CreateHeldEvent, CreateMapMaster,
  CreateMatchDraft, CreateOcrJob, CreateSeasonMaster, DeleteMatch, ExpiredSessionPruner,
  ExportMatches, GetMatch, GetMatchDraft, GetMatchDraftSourceImages, GetOcrDraft, GetOcrDraftsBulk,
  GetOcrJob, ListHeldEvents, ListMatches, OcrQueueOutboxDispatcher, OcrQueueSubmitter,
  PurgeSourceImages, SourceImageOrphanReaper, StaleOcrJobReaper, UpdateMatch, UpdateMatchDraft,
  UploadImage,
}

object HttpApp:
  /** Test-only handle for specs that need direct access to in-memory master repositories. */
  final case class Wired[F[_]](
      app: Http4sApp[F],
      gameTitles: momo.api.repositories.GameTitlesRepository[F],
      mapMasters: momo.api.repositories.MapMastersRepository[F],
      seasonMasters: momo.api.repositories.SeasonMastersRepository[F],
      idempotency: momo.api.repositories.IdempotencyRepository[F],
  )

  def resource[F[_]: Async](config: AppConfig): Resource[F, Http4sApp[F]] = wired[F](config)
    .map(_.app)

  /**
   * Build all dependencies. When `config.database` is set we use PostgreSQL repositories backed by
   * HikariCP; otherwise we wire up InMemory adapters (used by tests and the early dev environment).
   */
  def wired[F[_]: Async](config: AppConfig): Resource[F, Wired[F]] = Resource
    .eval(SecureRandom.javaSecuritySecureRandom[F]).flatMap { case given SecureRandom[F] =>
      JavaDiscordOAuthClient.resource[F](config.auth)
        .flatMap(oauthClient => wiredInner[F](config, oauthClient))
    }

  private def wiredInner[F[_]: Async: SecureRandom](
      config: AppConfig,
      oauthClient: DiscordOAuthClient[F],
  ): Resource[F, Wired[F]] = config.database match
    case Some(db) => Resource.eval(Async[F].executionContext).flatMap { connectExecutionContext =>
        (Database.transactor[F](db, connectExecutionContext), queueResource[F](config)).tupled
          .flatMap { (transactor, queue) =>
            given LoggerFactory[F] = Slf4jFactory.create[F]
            val jobs: OcrJobsRepository[F] = PostgresOcrJobsRepository[F](transactor)
            val drafts: OcrDraftsRepository[F] = PostgresOcrDraftsRepository[F](transactor)
            val ocrJobCreation: OcrJobCreationRepository[F] =
              PostgresOcrJobCreationRepository[F](transactor)
            val ocrQueueOutbox = PostgresOcrQueueOutboxRepository[F](transactor)
            val heldEvents: HeldEventsRepository[F] = PostgresHeldEventsRepository[F](transactor)
            val matches: MatchesRepository[F] = PostgresMatchesRepository[F](transactor)
            val matchDrafts: MatchDraftsRepository[F] = PostgresMatchDraftsRepository[F](transactor)
            val matchList: MatchListReadModel[F] = PostgresMatchListReadModel[F](transactor)
            val matchConfirmation: MatchConfirmationRepository[F] =
              PostgresMatchConfirmationRepository[F](transactor)
            val appSessions: AppSessionsRepository[F] = PostgresAppSessionsRepository[F](transactor)
            val members: MembersRepository[F] = PostgresMembersRepository[F](transactor)
            val gameTitles: GameTitlesRepository[F] = PostgresGameTitlesRepository[F](transactor)
            val mapMasters: MapMastersRepository[F] = PostgresMapMastersRepository[F](transactor)
            val seasonMasters: SeasonMastersRepository[F] =
              PostgresSeasonMastersRepository[F](transactor)
            val incidentMasters: IncidentMastersRepository[F] =
              PostgresIncidentMastersRepository[F](transactor)
            val idempotency: IdempotencyRepository[F] = PostgresIdempotencyRepository[F](transactor)
            val imageStore = LocalFsImageStore[F](config.imageTmpDir)
            val imageReferences: ImageReferenceRepository[F] =
              PostgresImageReferenceRepository[F](transactor)
            val ocrMaintenance: OcrJobMaintenanceRepository[F] =
              PostgresOcrJobMaintenanceRepository[F](transactor)
            val health = healthDetails[F](
              Some(Database.ping[F](transactor)),
              config.redis.map(_ => queue.ping),
            )
            OcrQueueOutboxDispatcher.resource[F](ocrQueueOutbox, queue).flatMap { _ =>
              runtimeMaintenance(
                config = config,
                imageStore = imageStore,
                imageReferences = imageReferences,
                ocrMaintenance = ocrMaintenance,
                appSessions = appSessions,
                now = Clock[F].realTimeInstant,
              ).evalMap { _ =>
                assemble(
                  config = config,
                  imageStore = imageStore,
                  healthDetails = health,
                  ocrQueueSubmitter = OcrQueueSubmitter.deferred[F],
                  ocrJobCreation = ocrJobCreation,
                  jobs = jobs,
                  drafts = drafts,
                  heldEvents = heldEvents,
                  matches = matches,
                  matchDrafts = matchDrafts,
                  matchList = matchList,
                  matchConfirmation = matchConfirmation,
                  appSessions = appSessions,
                  members = members,
                  gameTitles = gameTitles,
                  mapMasters = mapMasters,
                  seasonMasters = seasonMasters,
                  incidentMasters = incidentMasters,
                  idempotency = idempotency,
                  oauthClient = oauthClient,
                )
              }
            }
          }
      }
    case None => queueResource[F](config).flatMap { queue =>
        given LoggerFactory[F] = Slf4jFactory.create[F]
        Resource.eval(
          for
            jobs <- InMemoryOcrJobsRepository.create[F]
            drafts <- InMemoryOcrDraftsRepository.create[F]
            heldEvents <- InMemoryHeldEventsRepository.create[F]
            matches <- InMemoryMatchesRepository.create[F]
            matchDrafts <- InMemoryMatchDraftsRepository.create[F]
            matchList = InMemoryMatchListReadModel[F](matches, matchDrafts)
            matchConfirmation = InMemoryMatchConfirmationRepository[F](matches, matchDrafts)
            appSessions <- InMemoryAppSessionsRepository.create[F]
            members <- InMemoryMembersRepository.create[F](config.devMemberIds.map(id =>
              Member(MemberId(id), UserId(id), id, java.time.Instant.EPOCH)
            ))
            gameTitles <- InMemoryGameTitlesRepository.create[F]
            mapMasters <- InMemoryMapMastersRepository.create[F]
            seasonMasters <- InMemorySeasonMastersRepository.create[F]
            incidentMasters <- InMemoryIncidentMastersRepository.create[F]
            idempotency <- InMemoryIdempotencyRepository.create[F]
            ocrJobCreation = InMemoryOcrJobCreationRepository[F](drafts, jobs, matchDrafts)
            ocrQueueSubmitter = OcrQueueSubmitter.direct[F](jobs, matchDrafts, queue)
          yield (
            jobs,
            drafts,
            heldEvents,
            matches,
            matchDrafts,
            matchList,
            matchConfirmation,
            appSessions,
            members,
            gameTitles,
            mapMasters,
            seasonMasters,
            incidentMasters,
            idempotency,
            ocrJobCreation,
            ocrQueueSubmitter,
          )
        ).flatMap {
          case (
                jobs,
                drafts,
                heldEvents,
                matches,
                matchDrafts,
                matchList,
                matchConfirmation,
                appSessions,
                members,
                gameTitles,
                mapMasters,
                seasonMasters,
                incidentMasters,
                idempotency,
                ocrJobCreation,
                ocrQueueSubmitter,
              ) =>
            val imageStore = LocalFsImageStore[F](config.imageTmpDir)
            val imageReferences: ImageReferenceRepository[F] =
              new InMemoryImageReferenceRepository[F]
            val ocrMaintenance: OcrJobMaintenanceRepository[F] =
              new InMemoryOcrJobMaintenanceRepository[F]
            val health = healthDetails[F](None, config.redis.map(_ => queue.ping))
            runtimeMaintenance(
              config = config,
              imageStore = imageStore,
              imageReferences = imageReferences,
              ocrMaintenance = ocrMaintenance,
              appSessions = appSessions,
              now = Clock[F].realTimeInstant,
            ).evalMap { _ =>
              assemble(
                config = config,
                imageStore = imageStore,
                healthDetails = health,
                ocrQueueSubmitter = ocrQueueSubmitter,
                ocrJobCreation = ocrJobCreation,
                jobs = jobs,
                drafts = drafts,
                heldEvents = heldEvents,
                matches = matches,
                matchDrafts = matchDrafts,
                matchList = matchList,
                matchConfirmation = matchConfirmation,
                appSessions = appSessions,
                members = members,
                gameTitles = gameTitles,
                mapMasters = mapMasters,
                seasonMasters = seasonMasters,
                incidentMasters = incidentMasters,
                idempotency = idempotency,
                oauthClient = oauthClient,
              )
            }
        }
      }

  private def queueResource[F[_]: Async](config: AppConfig): Resource[F, QueueProducer[F]] =
    config.redis match
      case Some(redis) => RedisQueueProducer.resource[F](redis).widen
      case None => Resource.eval(InMemoryQueueProducer.create[F]).widen

  private def runtimeMaintenance[F[_]: Async: LoggerFactory](
      config: AppConfig,
      imageStore: LocalFsImageStore[F],
      imageReferences: ImageReferenceRepository[F],
      ocrMaintenance: OcrJobMaintenanceRepository[F],
      appSessions: AppSessionsRepository[F],
      now: F[java.time.Instant],
  ): Resource[F, Unit] = SourceImageOrphanReaper.resource[F](
    imageStore = imageStore,
    references = imageReferences,
    olderThan = config.resourceLimits.imageOrphanOlderThan,
    interval = config.resourceLimits.imageOrphanReaperInterval,
    now = now,
  ).flatMap(_ =>
    StaleOcrJobReaper.resource[F](
      jobs = ocrMaintenance,
      staleAfter = config.resourceLimits.staleOcrJobAfter,
      interval = config.resourceLimits.staleOcrJobReaperInterval,
      now = now,
    )
  ).flatMap(_ =>
    ExpiredSessionPruner.resource[F](
      sessions = appSessions,
      interval = config.resourceLimits.sessionPruneInterval,
      now = now,
    )
  )

  private def healthDetails[F[_]: Async](
      database: Option[F[Unit]],
      redis: Option[F[Unit]],
  ): F[HealthDetailsResponse] =
    def check(probe: Option[F[Unit]]): F[String] = probe match
      case None => Async[F].pure("disabled")
      case Some(value) => value.attempt.map(_.fold(_ => "unavailable", _ => "ok"))

    (check(database), check(redis)).mapN { (databaseStatus, redisStatus) =>
      val required = List(databaseStatus, redisStatus).filterNot(_ == "disabled")
      val status = if required.forall(_ == "ok") then "ok" else "degraded"
      HealthDetailsResponse(status, databaseStatus, redisStatus)
    }

  private def assemble[F[_]: Async: SecureRandom](
      config: AppConfig,
      imageStore: LocalFsImageStore[F],
      healthDetails: F[HealthDetailsResponse],
      ocrQueueSubmitter: OcrQueueSubmitter[F],
      ocrJobCreation: OcrJobCreationRepository[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      heldEvents: HeldEventsRepository[F],
      matches: MatchesRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      matchList: MatchListReadModel[F],
      matchConfirmation: MatchConfirmationRepository[F],
      appSessions: AppSessionsRepository[F],
      members: MembersRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      idempotency: IdempotencyRepository[F],
      oauthClient: DiscordOAuthClient[F],
  ): F[Wired[F]] =
    val roster = MemberRoster.dev(config.devMemberIds)
    val uploadImage = UploadImage[F](imageStore)
    val nowF = Clock[F].realTimeInstant
    val nextId = OcrJobId.fresh[F].map(_.value)
    val sessionService = SessionService[F](appSessions, members, config.auth, nowF)
    val csrfTokenService = CsrfTokenService()
    val oauthStateCodec = OAuthStateCodec[F](config.auth, nowF)
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStore,
      creation = ocrJobCreation,
      matchDrafts = matchDrafts,
      queueSubmitter = ocrQueueSubmitter,
      now = nowF,
      nextId = nextId,
      requestIdLookup = RequestIdMiddleware.lookup[F],
    )
    val getOcrJob = GetOcrJob[F](jobs)
    val getOcrDraft = GetOcrDraft[F](drafts)
    val getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts)
    val cancelOcrJob = CancelOcrJob[F](jobs, nowF)
    val listHeldEvents = ListHeldEvents[F](heldEvents, matches)
    val createHeldEvent = CreateHeldEvent[F](heldEvents, nextId)
    val sourceImageRetention = PurgeSourceImages[F](matchDrafts, imageStore)
    val createMatchDraft = CreateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = nowF,
      nextId = nextId,
    )
    val getMatchDraft = GetMatchDraft[F](matchDrafts)
    val updateMatchDraft = UpdateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = nowF,
    )
    val cancelMatchDraft = CancelMatchDraft[F](matchDrafts, sourceImageRetention, nowF)
    val getMatchDraftSourceImages = GetMatchDraftSourceImages[F](matchDrafts, imageStore)
    val confirmMatch = ConfirmMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      matchDrafts = matchDrafts,
      confirmations = matchConfirmation,
      sourceImageRetention = sourceImageRetention,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      nextId = nextId,
      allowedMemberIds = config.devMemberIds.map(MemberId(_)).toSet,
    )
    val listMatches = ListMatches[F](matchList)
    val exportMatches = ExportMatches[F](matches, members, mapMasters, seasonMasters)
    val getMatch = GetMatch[F](matches)
    val updateMatch = UpdateMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      allowedMemberIds = config.devMemberIds.map(MemberId(_)).toSet,
    )
    val deleteMatch = DeleteMatch[F](matches)
    val createGameTitle = CreateGameTitle[F](gameTitles, nowF)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, nowF)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, nowF)

    (
      LoginRateLimiter.create[F](config.auth.rateLimitPerMinute, nowF),
      LoginRateLimiter.create[F](config.resourceLimits.uploadRateLimitPerMinute, nowF),
      LoginRateLimiter.create[F](config.resourceLimits.exportRateLimitPerMinute, nowF),
    ).mapN { (loginRateLimiter, uploadRateLimiter, exportRateLimiter) =>
      val app = HttpRoutes.routes(HttpRoutes.Dependencies(
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
        createMatchDraft = createMatchDraft,
        getMatchDraft = getMatchDraft,
        updateMatchDraft = updateMatchDraft,
        cancelMatchDraft = cancelMatchDraft,
        getMatchDraftSourceImages = getMatchDraftSourceImages,
        confirmMatch = confirmMatch,
        exportMatches = exportMatches,
        listMatches = listMatches,
        getMatch = getMatch,
        updateMatch = updateMatch,
        deleteMatch = deleteMatch,
        gameTitles = gameTitles,
        mapMasters = mapMasters,
        seasonMasters = seasonMasters,
        incidentMasters = incidentMasters,
        createGameTitle = createGameTitle,
        createMapMaster = createMapMaster,
        createSeasonMaster = createSeasonMaster,
        members = members,
        oauthClient = oauthClient,
        sessionService = sessionService,
        csrfTokenService = csrfTokenService,
        oauthStateCodec = oauthStateCodec,
        loginRateLimiter = loginRateLimiter,
        rateLimiters = HttpRateLimiters(uploadRateLimiter, exportRateLimiter),
        idempotency = idempotency,
        healthDetails = healthDetails,
        nowF = nowF,
      ))
      Wired(app, gameTitles, mapMasters, seasonMasters, idempotency)
    }
