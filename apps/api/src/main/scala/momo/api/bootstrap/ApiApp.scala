package momo.api.bootstrap

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*
import org.http4s.HttpApp as Http4sApp
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.slf4j.Slf4jFactory

import momo.api.adapters.{
  InMemoryAppSessionsRepository, InMemoryGameTitlesRepository, InMemoryHeldEventDeletionRepository,
  InMemoryHeldEventsRepository, InMemoryIdempotencyRepository, InMemoryImageReferenceRepository,
  InMemoryIncidentMastersRepository, InMemoryLoginAccountsRepository, InMemoryMapMastersRepository,
  InMemoryMatchConfirmationRepository, InMemoryMatchDraftsRepository, InMemoryMatchListReadModel,
  InMemoryMatchesRepository, InMemoryMemberAliasesRepository, InMemoryMembersRepository,
  InMemoryOcrDraftsRepository, InMemoryOcrJobCreationRepository,
  InMemoryOcrJobMaintenanceRepository, InMemoryOcrJobsRepository, InMemoryQueueProducer,
  InMemorySeasonMastersRepository, LocalFsImageStore, RedisQueueProducer,
}
import momo.api.auth.{
  CreatedSession, CsrfTokenService, DiscordOAuthClient, InMemoryOAuthProviderBackoff,
  JavaDiscordOAuthClient, LoginRateLimiter, MemberRoster, OAuthProviderBackoff, OAuthStateCodec,
  RateLimiter, RedisOAuthProviderBackoff, RedisRateLimiter, SessionService,
}
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{LoginAccount, Member}
import momo.api.endpoints.HealthEndpoints.HealthDetailsResponse
import momo.api.http.{HttpRateLimiters, HttpRoutes}
import momo.api.repositories.postgres.*
import momo.api.repositories.{
  AppSessionsRepository, GameTitlesRepository, HeldEventDeletionRepository, HeldEventsRepository,
  IdempotencyRepository, ImageOrphanStore, ImageReferenceRepository, IncidentMastersRepository,
  LoginAccountsRepository, MapMastersRepository, MatchConfirmationRepository, MatchDraftsRepository,
  MatchListReadModel, MatchesRepository, MemberAliasesRepository, MembersRepository,
  OcrDraftsRepository, OcrJobCreationRepository, OcrJobMaintenanceRepository, OcrJobsRepository,
  QueueHealthProbe, QueueProducer, SeasonMastersRepository,
}
import momo.api.usecases.*

object ApiApp:
  /** Fully wired runtime. Specs use the exposed repositories to seed in-memory resources. */
  final case class Runtime[F[_]](
      app: Http4sApp[F],
      gameTitles: momo.api.repositories.GameTitlesRepository[F],
      mapMasters: momo.api.repositories.MapMastersRepository[F],
      seasonMasters: momo.api.repositories.SeasonMastersRepository[F],
      idempotency: momo.api.repositories.IdempotencyRepository[F],
      loginAccounts: momo.api.repositories.LoginAccountsRepository[F],
      createSession: LoginAccount => F[CreatedSession],
  )

  private final case class RuntimeInfrastructure[F[_]](
      queue: QueueProducer[F],
      queueHealth: QueueHealthProbe[F],
      loginRateLimiter: RateLimiter[F],
      authCallbackStateRateLimiter: RateLimiter[F],
      oauthProviderBackoff: OAuthProviderBackoff[F],
      rateLimiters: HttpRateLimiters[F],
  )

  def resource[F[_]: Async](config: AppConfig): Resource[F, Http4sApp[F]] = wired[F](config)
    .map(_.app)

  /**
   * Build all dependencies. When `config.database` is set we use PostgreSQL repositories backed by
   * HikariCP; otherwise we wire up InMemory adapters (used by tests and the early dev environment).
   */
  def wired[F[_]: Async](config: AppConfig): Resource[F, Runtime[F]] = Resource
    .eval(SecureRandom.javaSecuritySecureRandom[F]).flatMap { case given SecureRandom[F] =>
      JavaDiscordOAuthClient.resource[F](config.auth)
        .flatMap(oauthClient => wiredInner[F](config, oauthClient))
    }

  private def wiredInner[F[_]: Async: SecureRandom](
      config: AppConfig,
      oauthClient: DiscordOAuthClient[F],
  ): Resource[F, Runtime[F]] = config.database match
    case Some(db) => (
        Database.transactor[F](db),
        runtimeInfrastructureResource[F](config, Clock[F].realTimeInstant),
      ).tupled.flatMap { (transactor, infrastructure) =>
        given LoggerFactory[F] = Slf4jFactory.create[F]
        val queue = infrastructure.queue
        val jobs: OcrJobsRepository[F] = PostgresOcrJobsRepository[F](transactor)
        val drafts: OcrDraftsRepository[F] = PostgresOcrDraftsRepository[F](transactor)
        val ocrJobCreation: OcrJobCreationRepository[F] =
          PostgresOcrJobCreationRepository[F](transactor)
        val ocrQueueOutbox = PostgresOcrQueueOutboxRepository[F](transactor)
        val heldEvents: HeldEventsRepository[F] = PostgresHeldEventsRepository[F](transactor)
        val heldEventDeletion: HeldEventDeletionRepository[F] =
          PostgresHeldEventDeletionRepository[F](transactor)
        val matches: MatchesRepository[F] = PostgresMatchesRepository[F](transactor)
        val matchDrafts: MatchDraftsRepository[F] = PostgresMatchDraftsRepository[F](transactor)
        val matchList: MatchListReadModel[F] = PostgresMatchListReadModel[F](transactor)
        val matchConfirmation: MatchConfirmationRepository[F] =
          PostgresMatchConfirmationRepository[F](transactor)
        val appSessions: AppSessionsRepository[F] = PostgresAppSessionsRepository[F](transactor)
        val members: MembersRepository[F] = PostgresMembersRepository[F](transactor)
        val loginAccounts: LoginAccountsRepository[F] =
          PostgresLoginAccountsRepository[F](transactor)
        val gameTitles: GameTitlesRepository[F] = PostgresGameTitlesRepository[F](transactor)
        val mapMasters: MapMastersRepository[F] = PostgresMapMastersRepository[F](transactor)
        val seasonMasters: SeasonMastersRepository[F] =
          PostgresSeasonMastersRepository[F](transactor)
        val incidentMasters: IncidentMastersRepository[F] =
          PostgresIncidentMastersRepository[F](transactor)
        val memberAliases: MemberAliasesRepository[F] =
          PostgresMemberAliasesRepository[F](transactor)
        val idempotency: IdempotencyRepository[F] = PostgresIdempotencyRepository[F](transactor)
        val imageStore = LocalFsImageStore[F](config.imageTmpDir)
        val imageReferences: ImageReferenceRepository[F] =
          PostgresImageReferenceRepository[F](transactor)
        val ocrMaintenance: OcrJobMaintenanceRepository[F] =
          PostgresOcrJobMaintenanceRepository[F](transactor)
        val ocrAdmissionGuard = OcrAdmissionGuard.from[F](
          ocrQueueOutbox,
          infrastructure.queueHealth,
          OcrAdmissionGuard.Config.fromResourceLimits(config.resourceLimits),
        )
        val health = healthDetails[F](
          Some(Database.ping[F](transactor)),
          config.redis.map(_ => infrastructure.queueHealth.ping),
          Some(ocrAdmissionGuard.healthStatus),
        )
        OcrQueueOutboxDispatcher.resource[F](
          ocrQueueOutbox,
          queue,
          OcrQueueOutboxDispatcherConfig(pollInterval =
            config.resourceLimits.ocrOutboxRecoveryInterval
          ),
        ).flatMap { _ =>
          runtimeMaintenance(
            config = config,
            imageStore = imageStore,
            imageReferences = imageReferences,
            ocrMaintenance = ocrMaintenance,
            appSessions = appSessions,
            idempotency = idempotency,
            now = Clock[F].realTimeInstant,
          ).evalMap { _ =>
            assemble(
              config = config,
              imageStore = imageStore,
              imageReferences = imageReferences,
              healthDetails = health,
              ocrQueueSubmitter = OcrQueueSubmitter.outboxBacked[F](ocrQueueOutbox, queue),
              ocrAdmissionGuard = ocrAdmissionGuard,
              ocrJobCreation = ocrJobCreation,
              jobs = jobs,
              drafts = drafts,
              heldEvents = heldEvents,
              heldEventDeletion = heldEventDeletion,
              matches = matches,
              matchDrafts = matchDrafts,
              matchList = matchList,
              matchConfirmation = matchConfirmation,
              appSessions = appSessions,
              members = members,
              loginAccounts = loginAccounts,
              gameTitles = gameTitles,
              mapMasters = mapMasters,
              seasonMasters = seasonMasters,
              incidentMasters = incidentMasters,
              memberAliases = memberAliases,
              idempotency = idempotency,
              oauthClient = oauthClient,
              loginRateLimiter = infrastructure.loginRateLimiter,
              authCallbackStateRateLimiter = infrastructure.authCallbackStateRateLimiter,
              oauthProviderBackoff = infrastructure.oauthProviderBackoff,
              rateLimiters = infrastructure.rateLimiters,
            )
          }
        }
      }
    case None => runtimeInfrastructureResource[F](config, Clock[F].realTimeInstant)
        .flatMap { infrastructure =>
          val queue = infrastructure.queue
          given LoggerFactory[F] = Slf4jFactory.create[F]
          Resource.eval(
            for
              matchDrafts <- InMemoryMatchDraftsRepository.create[F]
              jobs <- InMemoryOcrJobsRepository.createWithDraftCancelSync[F](matchDrafts)
              drafts <- InMemoryOcrDraftsRepository.create[F]
              heldEvents <- InMemoryHeldEventsRepository.create[F]
              matches <- InMemoryMatchesRepository.create[F]
              matchList = InMemoryMatchListReadModel[F](
                matches,
                matchDrafts,
                ocrJobs = Some(jobs),
                ocrDrafts = Some(drafts),
              )
              matchConfirmation = InMemoryMatchConfirmationRepository[F](matches, matchDrafts)
              heldEventDeletion =
                InMemoryHeldEventDeletionRepository[F](heldEvents, matches, matchDrafts)
              appSessions <- InMemoryAppSessionsRepository.create[F]
              members <- InMemoryMembersRepository.create[F](config.devMemberIds.map(id =>
                Member(
                  MemberId.unsafeFromString(id),
                  UserId.unsafeFromString(id),
                  id,
                  java.time.Instant.EPOCH,
                )
              ))
              loginAccounts <- InMemoryLoginAccountsRepository
                .create[F](config.devMemberIds.zipWithIndex.map { (id, index) =>
                  LoginAccount(
                    MemberRoster.devAccountIdFor(id),
                    UserId.unsafeFromString(id),
                    id,
                    Some(MemberId.unsafeFromString(id)),
                    loginEnabled = true,
                    isAdmin = index == 0,
                    createdAt = java.time.Instant.EPOCH,
                    updatedAt = java.time.Instant.EPOCH,
                  )
                })
              gameTitles <- InMemoryGameTitlesRepository.create[F]
              mapMasters <- InMemoryMapMastersRepository.create[F]
              seasonMasters <- InMemorySeasonMastersRepository.create[F]
              incidentMasters <- InMemoryIncidentMastersRepository.create[F]
              memberAliases <- InMemoryMemberAliasesRepository.create[F]
              idempotency <- InMemoryIdempotencyRepository.create[F]
              ocrJobCreation = InMemoryOcrJobCreationRepository[F](drafts, jobs, matchDrafts)
              ocrQueueSubmitter = OcrQueueSubmitter.direct[F](jobs, matchDrafts, queue)
              ocrAdmissionGuard = OcrAdmissionGuard.allowAll[F]
            yield (
              jobs,
              drafts,
              heldEvents,
              matches,
              matchDrafts,
              heldEventDeletion,
              matchList,
              matchConfirmation,
              appSessions,
              members,
              loginAccounts,
              gameTitles,
              mapMasters,
              seasonMasters,
              incidentMasters,
              memberAliases,
              idempotency,
              ocrJobCreation,
              ocrQueueSubmitter,
              ocrAdmissionGuard,
            )
          ).flatMap {
            case (
                  jobs,
                  drafts,
                  heldEvents,
                  matches,
                  matchDrafts,
                  heldEventDeletion,
                  matchList,
                  matchConfirmation,
                  appSessions,
                  members,
                  loginAccounts,
                  gameTitles,
                  mapMasters,
                  seasonMasters,
                  incidentMasters,
                  memberAliases,
                  idempotency,
                  ocrJobCreation,
                  ocrQueueSubmitter,
                  ocrAdmissionGuard,
                ) =>
              val imageStore = LocalFsImageStore[F](config.imageTmpDir)
              val imageReferences: ImageReferenceRepository[F] =
                new InMemoryImageReferenceRepository[F]
              val ocrMaintenance: OcrJobMaintenanceRepository[F] =
                new InMemoryOcrJobMaintenanceRepository[F]
              val health =
                healthDetails[F](None, config.redis.map(_ => infrastructure.queueHealth.ping), None)
              runtimeMaintenance(
                config = config,
                imageStore = imageStore,
                imageReferences = imageReferences,
                ocrMaintenance = ocrMaintenance,
                appSessions = appSessions,
                idempotency = idempotency,
                now = Clock[F].realTimeInstant,
              ).evalMap { _ =>
                assemble(
                  config = config,
                  imageStore = imageStore,
                  imageReferences = imageReferences,
                  healthDetails = health,
                  ocrQueueSubmitter = ocrQueueSubmitter,
                  ocrAdmissionGuard = ocrAdmissionGuard,
                  ocrJobCreation = ocrJobCreation,
                  jobs = jobs,
                  drafts = drafts,
                  heldEvents = heldEvents,
                  heldEventDeletion = heldEventDeletion,
                  matches = matches,
                  matchDrafts = matchDrafts,
                  matchList = matchList,
                  matchConfirmation = matchConfirmation,
                  appSessions = appSessions,
                  members = members,
                  loginAccounts = loginAccounts,
                  gameTitles = gameTitles,
                  mapMasters = mapMasters,
                  seasonMasters = seasonMasters,
                  incidentMasters = incidentMasters,
                  memberAliases = memberAliases,
                  idempotency = idempotency,
                  oauthClient = oauthClient,
                  loginRateLimiter = infrastructure.loginRateLimiter,
                  authCallbackStateRateLimiter = infrastructure.authCallbackStateRateLimiter,
                  oauthProviderBackoff = infrastructure.oauthProviderBackoff,
                  rateLimiters = infrastructure.rateLimiters,
                )
              }
          }
        }

  private def runtimeInfrastructureResource[F[_]: Async](
      config: AppConfig,
      now: F[java.time.Instant],
  ): Resource[F, RuntimeInfrastructure[F]] = config.redis match
    case Some(redis) => Redis[F].simple(redis.url, RedisCodec.Utf8).map { commands =>
        val queue: QueueProducer[F] = RedisQueueProducer.fromCommands(redis.stream, commands)
        val queueHealth: QueueHealthProbe[F] = RedisQueueProducer
          .healthProbeFromCommands(redis.deadLetterStream, commands)
        val login: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "login", config.auth.rateLimitPerMinute, now)
        val authCallbackState: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "auth-callback-state",
          config.auth.callbackStateRateLimitPerMinute,
          now,
        )
        val oauthProviderBackoff: OAuthProviderBackoff[F] = RedisOAuthProviderBackoff.fromCommands(
          commands,
          "discord",
          config.auth.providerFailureThreshold,
          config.auth.providerBackoff,
          now,
        )
        val upload: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "upload", config.resourceLimits.uploadRateLimitPerMinute, now)
        val exportLimiter: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "export", config.resourceLimits.exportRateLimitPerMinute, now)
        val exportAllLimiter: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "export-all",
          config.resourceLimits.exportAllRateLimitPerMinute,
          now,
        )
        val sourceImageDownload: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "source-image-download",
          config.resourceLimits.sourceImageDownloadRateLimitPerMinute,
          now,
        )
        val readApi: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "read-api", config.resourceLimits.readApiRateLimitPerMinute, now)
        val ocrJobCreate: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "ocr-job-create",
          config.resourceLimits.ocrJobCreateRateLimitPerMinute,
          now,
        )
        val ocrJobCreateGlobal: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "ocr-job-create-global",
          config.resourceLimits.ocrJobCreateGlobalRateLimitPerMinute,
          now,
        )
        RuntimeInfrastructure(
          queue,
          queueHealth,
          login,
          authCallbackState,
          oauthProviderBackoff,
          HttpRateLimiters(
            upload,
            exportLimiter,
            exportAllLimiter,
            sourceImageDownload,
            readApi,
            ocrJobCreate,
            ocrJobCreateGlobal,
          ),
        )
      }
    case None => Resource.eval(
        for
          queue <- InMemoryQueueProducer.create[F]
          queueHealth = QueueHealthProbe.healthy[F]
          login <- LoginRateLimiter.create[F](config.auth.rateLimitPerMinute, now)
          authCallbackState <- LoginRateLimiter
            .create[F](config.auth.callbackStateRateLimitPerMinute, now)
          oauthProviderBackoff <- InMemoryOAuthProviderBackoff
            .create[F](config.auth.providerFailureThreshold, config.auth.providerBackoff, now)
          upload <- LoginRateLimiter.create[F](config.resourceLimits.uploadRateLimitPerMinute, now)
          exportLimiter <- LoginRateLimiter
            .create[F](config.resourceLimits.exportRateLimitPerMinute, now)
          exportAllLimiter <- LoginRateLimiter
            .create[F](config.resourceLimits.exportAllRateLimitPerMinute, now)
          sourceImageDownload <- LoginRateLimiter
            .create[F](config.resourceLimits.sourceImageDownloadRateLimitPerMinute, now)
          readApi <- LoginRateLimiter
            .create[F](config.resourceLimits.readApiRateLimitPerMinute, now)
          ocrJobCreate <- LoginRateLimiter
            .create[F](config.resourceLimits.ocrJobCreateRateLimitPerMinute, now)
          ocrJobCreateGlobal <- LoginRateLimiter
            .create[F](config.resourceLimits.ocrJobCreateGlobalRateLimitPerMinute, now)
        yield RuntimeInfrastructure(
          queue,
          queueHealth,
          login,
          authCallbackState,
          oauthProviderBackoff,
          HttpRateLimiters(
            upload,
            exportLimiter,
            exportAllLimiter,
            sourceImageDownload,
            readApi,
            ocrJobCreate,
            ocrJobCreateGlobal,
          ),
        )
      )

  private def runtimeMaintenance[F[_]: Async: LoggerFactory](
      config: AppConfig,
      imageStore: ImageOrphanStore[F],
      imageReferences: ImageReferenceRepository[F],
      ocrMaintenance: OcrJobMaintenanceRepository[F],
      appSessions: AppSessionsRepository[F],
      idempotency: IdempotencyRepository[F],
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
  ).flatMap(_ =>
    PeriodicMaintenance
      .resource("idempotency_key_pruner", config.resourceLimits.sessionPruneInterval)(
        now.flatMap(idempotency.cleanup).void
      )
  )

  private def healthDetails[F[_]: Async](
      database: Option[F[Unit]],
      redis: Option[F[Unit]],
      ocrAdmission: Option[F[String]],
  ): F[HealthDetailsResponse] =
    def check(probe: Option[F[Unit]]): F[String] = probe match
      case None => Async[F].pure("disabled")
      case Some(value) => value.attempt.map(_.fold(_ => "unavailable", _ => "ok"))

    def checkStatus(probe: Option[F[String]]): F[String] = probe match
      case None => Async[F].pure("disabled")
      case Some(value) => value.handleError(_ => "unavailable")

    (check(database), check(redis), checkStatus(ocrAdmission)).mapN {
      (databaseStatus, redisStatus, ocrAdmissionStatus) =>
        val required = List(databaseStatus, redisStatus, ocrAdmissionStatus)
          .filterNot(_ == "disabled")
        val status = if required.forall(_ == "ok") then "ok" else "degraded"
        HealthDetailsResponse(status, databaseStatus, redisStatus, ocrAdmissionStatus)
    }

  private def assemble[F[_]: Async: SecureRandom: LoggerFactory](
      config: AppConfig,
      imageStore: LocalFsImageStore[F],
      imageReferences: ImageReferenceRepository[F],
      healthDetails: F[HealthDetailsResponse],
      ocrQueueSubmitter: OcrQueueSubmitter[F],
      ocrAdmissionGuard: OcrAdmissionGuard[F],
      ocrJobCreation: OcrJobCreationRepository[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      heldEvents: HeldEventsRepository[F],
      heldEventDeletion: HeldEventDeletionRepository[F],
      matches: MatchesRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      matchList: MatchListReadModel[F],
      matchConfirmation: MatchConfirmationRepository[F],
      appSessions: AppSessionsRepository[F],
      members: MembersRepository[F],
      loginAccounts: LoginAccountsRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      memberAliases: MemberAliasesRepository[F],
      idempotency: IdempotencyRepository[F],
      oauthClient: DiscordOAuthClient[F],
      loginRateLimiter: RateLimiter[F],
      authCallbackStateRateLimiter: RateLimiter[F],
      oauthProviderBackoff: OAuthProviderBackoff[F],
      rateLimiters: HttpRateLimiters[F],
  ): F[Runtime[F]] =
    val roster = MemberRoster.dev(config.devMemberIds)
    val imageStorageAdmission = ImageStorageAdmission.from[F](
      imageStore,
      imageReferences,
      ImageStorageAdmission.Config.fromResourceLimits(config.resourceLimits),
    )
    val uploadImage = UploadImage[F](imageStore, imageStorageAdmission)
    val nowF = Clock[F].realTimeInstant
    val nextId = OcrJobId.fresh[F].map(_.value)
    val sessionService = SessionService[F](appSessions, loginAccounts, config.auth, nowF)
    val csrfTokenService = CsrfTokenService()
    val oauthStateCodec = OAuthStateCodec[F](config.auth, nowF)
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStore,
      creation = ocrJobCreation,
      matchDrafts = matchDrafts,
      queueSubmitter = ocrQueueSubmitter,
      admissionGuard = ocrAdmissionGuard,
      now = nowF,
      nextId = nextId,
      memberAliases = memberAliases,
      activeJobLimit = config.resourceLimits.ocrActiveJobLimit,
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
    val getMatchDraftSourceImages = GetMatchDraftSourceImages[F](
      matchDrafts,
      imageStore,
      config.resourceLimits.sourceImageArchiveMaxBytes,
    )
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
      allowedMemberIds = members.list.map(_.map(_.id).toSet),
    )
    val listMatches = ListMatches[F](matchList)
    val exportMatches = ExportMatches[F](
      matches,
      members,
      mapMasters,
      seasonMasters,
      ExportMatches.Limits.fromResourceLimits(config.resourceLimits),
    )
    val getMatch = GetMatch[F](matches)
    val updateMatch = UpdateMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      allowedMemberIds = members.list.map(_.map(_.id).toSet),
    )
    val deleteMatch = DeleteMatch[F](matches)
    val deleteHeldEvent = DeleteHeldEvent[F](heldEventDeletion)
    val listGameTitles = ListGameTitles[F](gameTitles)
    val listMapMasters = ListMapMasters[F](mapMasters)
    val listSeasonMasters = ListSeasonMasters[F](seasonMasters)
    val listIncidentMasters = ListIncidentMasters[F](incidentMasters)
    val createGameTitle = CreateGameTitle[F](gameTitles, nowF)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, nowF)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, nowF)
    val updateGameTitle = UpdateGameTitle[F](gameTitles)
    val updateMapMaster = UpdateMapMaster[F](mapMasters)
    val updateSeasonMaster = UpdateSeasonMaster[F](seasonMasters)
    val deleteGameTitle = DeleteGameTitle[F](gameTitles)
    val deleteMapMaster = DeleteMapMaster[F](mapMasters)
    val deleteSeasonMaster = DeleteSeasonMaster[F](seasonMasters)
    val listMemberAliases = ListMemberAliases[F](memberAliases)
    val createMemberAlias = CreateMemberAlias[F](memberAliases, members, nowF, nextId)
    val updateMemberAlias = UpdateMemberAlias[F](memberAliases, members)
    val deleteMemberAlias = DeleteMemberAlias[F](memberAliases)
    val listLoginAccounts = ListLoginAccounts[F](loginAccounts)
    val createLoginAccount = CreateLoginAccount[F](loginAccounts, members, nowF, nextId)
    val updateLoginAccount = UpdateLoginAccount[F](loginAccounts, members, appSessions, nowF)

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
      deleteHeldEvent = deleteHeldEvent,
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
      loginAccounts = loginAccounts,
      listLoginAccounts = listLoginAccounts,
      createLoginAccount = createLoginAccount,
      updateLoginAccount = updateLoginAccount,
      listGameTitles = listGameTitles,
      listMapMasters = listMapMasters,
      listSeasonMasters = listSeasonMasters,
      listIncidentMasters = listIncidentMasters,
      createGameTitle = createGameTitle,
      createMapMaster = createMapMaster,
      createSeasonMaster = createSeasonMaster,
      updateGameTitle = updateGameTitle,
      updateMapMaster = updateMapMaster,
      updateSeasonMaster = updateSeasonMaster,
      deleteGameTitle = deleteGameTitle,
      deleteMapMaster = deleteMapMaster,
      deleteSeasonMaster = deleteSeasonMaster,
      listMemberAliases = listMemberAliases,
      createMemberAlias = createMemberAlias,
      updateMemberAlias = updateMemberAlias,
      deleteMemberAlias = deleteMemberAlias,
      oauthClient = oauthClient,
      sessionService = sessionService,
      csrfTokenService = csrfTokenService,
      oauthStateCodec = oauthStateCodec,
      loginRateLimiter = loginRateLimiter,
      authCallbackStateRateLimiter = authCallbackStateRateLimiter,
      oauthProviderBackoff = oauthProviderBackoff,
      rateLimiters = rateLimiters,
      idempotency = idempotency,
      healthDetails = healthDetails,
      nowF = nowF,
    ))
    Runtime(
      app,
      gameTitles,
      mapMasters,
      seasonMasters,
      idempotency,
      loginAccounts,
      sessionService.create,
    ).pure[F]
