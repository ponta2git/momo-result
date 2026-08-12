package momo.api.bootstrap

import scala.concurrent.duration.*

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.slf4j.Slf4jFactory

import momo.api.adapters.postgres.*
import momo.api.adapters.storage.local.LocalSourceImageObjectStorage
import momo.api.adapters.storage.objectstore.{
  ObjectBackedImageMaintenance,
  ObjectBackedImageStore,
  SourceImageObjectReconciler,
  SourceImageObjectReconcilerConfig
}
import momo.api.adapters.storage.r2.{
  R2Credentials,
  R2SourceImageObjectStorage,
  R2SourceImageObjectStorageConfig
}
import momo.api.auth.DiscordOAuthClient
import momo.api.config.{AppConfig, DatabaseConfig, SourceImageStorageConfig}
import momo.api.db.Database
import momo.api.domain.ids.ImageId
import momo.api.ports.storage.{
  ImageDiskUsage,
  ImageOrphanCleaner,
  ImageStorage,
  ImageStorageInspector,
  SourceImageObjectStorage
}
import momo.api.repositories.*
import momo.api.usecases.ocr.*
import momo.api.usecases.seriesanalysis.{
  SeriesAnalysisQueueDispatcherConfig,
  SeriesAnalysisQueueOutboxDispatcher
}

private[bootstrap] object PostgresApiRuntime:
  def resource[F[_]: Async: SecureRandom](
      config: AppConfig,
      db: DatabaseConfig,
      oauthClient: DiscordOAuthClient[F],
  ): Resource[F, ApiApp.Runtime[F]] = (
    Database.transactor[F](db),
    RuntimeInfrastructure.resource[F](config, Clock[F].realTimeInstant),
  ).tupled.flatMap { (transactor, infrastructure) =>
    given LoggerFactory[F] = Slf4jFactory.create[F]
    val queue = infrastructure.queue
    val jobs: OcrJobsRepository[F] = PostgresOcrJobsRepository[F](transactor)
    val drafts: OcrDraftsRepository[F] = PostgresOcrDraftsRepository[F](transactor)
    val ocrJobCreationStore: OcrJobCreationStore[F] =
      PostgresOcrJobCreationStore[F](transactor)
    val ocrQueueOutbox = PostgresOcrQueueOutboxRepository[F](transactor)
    val analysisQueueOutbox = PostgresSeriesAnalysisQueueOutboxRepository[F](transactor)
    val heldEvents: HeldEventsRepository[F] = PostgresHeldEventsRepository[F](transactor)
    val heldEventDeletion: HeldEventDeletionRepository[F] =
      PostgresHeldEventDeletionRepository[F](transactor)
    val matches: MatchesRepository[F] = PostgresMatchesRepository[F](transactor)
    val matchDrafts: MatchDraftsRepository[F] = PostgresMatchDraftsRepository[F](transactor)
    val matchDraftCancellation: MatchDraftCancellationRepository[F] =
      PostgresMatchDraftCancellationRepository[F](transactor)
    val matchList: MatchListReadModel[F] = PostgresMatchListReadModel[F](transactor)
    val matchConfirmation: MatchConfirmationRepository[F] =
      PostgresMatchConfirmationRepository[F](transactor)
    val appSessions: AppSessionsRepository[F] = PostgresAppSessionsRepository[F](transactor)
    val sessionAccounts: SessionAccountLookup[F] = PostgresSessionAccountLookup[F](transactor)
    val members: MembersRepository[F] = PostgresMembersRepository[F](transactor)
    val loginAccounts: LoginAccountsRepository[F] =
      PostgresLoginAccountsRepository[F](transactor)
    val loginAccountAdministration: LoginAccountAdministrationRepository[F] =
      PostgresLoginAccountAdministrationRepository[F](transactor)
    val gameTitles: GameTitlesRepository[F] = PostgresGameTitlesRepository[F](transactor)
    val mapMasters: MapMastersRepository[F] = PostgresMapMastersRepository[F](transactor)
    val seasonMasters: SeasonMastersRepository[F] =
      PostgresSeasonMastersRepository[F](transactor)
    val incidentMasters: IncidentMastersRepository[F] =
      PostgresIncidentMastersRepository[F](transactor)
    val memberAliases: MemberAliasesRepository[F] =
      PostgresMemberAliasesRepository[F](transactor)
    val idempotency: IdempotencyRepository[F] = PostgresIdempotencyRepository[F](transactor)
    val sourceImages: SourceImagesRepository[F] = PostgresSourceImagesRepository[F](transactor)
    val imageReferences: ImageReferenceRepository[F] =
      PostgresImageReferenceRepository[F](transactor)
    val ocrMaintenance: OcrJobMaintenanceRepository[F] =
      PostgresOcrJobMaintenanceRepository[F](transactor)
    val ocrAdmissionGuard = OcrAdmissionGuard.from[F](
      ocrQueueOutbox,
      infrastructure.queueHealth,
      ApiApp.ocrAdmissionGuardConfig(config.resourceLimits),
    )
    val health = RuntimeHealthDetails.build[F](
      Some(Database.ping[F](transactor)),
      config.redis.map(_ => infrastructure.queueHealth.ping),
      Some(ocrAdmissionGuard.healthStatus),
    )

    val analysisDispatcher = infrastructure.analysisQueue.fold(Resource.unit[F]) { queue =>
      SeriesAnalysisQueueOutboxDispatcher.resource[F](
        analysisQueueOutbox,
        queue,
        SeriesAnalysisQueueDispatcherConfig(),
      )
    }
    val dispatchers = (
      OcrQueueOutboxDispatcher.resource[F](
        ocrQueueOutbox,
        queue,
        OcrQueueOutboxDispatcherConfig(pollInterval =
          config.resourceLimits.ocrOutboxRecoveryInterval
        ),
      ),
      analysisDispatcher,
      PostgresSeriesAnalysisReaderCapability.resource[F](transactor),
    ).tupled

    imageStorageResource(config, sourceImages).flatMap { imageStorage =>
      dispatchers.flatMap { _ =>
        RuntimeMaintenance.resource(
          config = config,
          imageStore = imageStorage.cleaner,
          imageReferences = imageReferences,
          ocrMaintenance = ocrMaintenance,
          appSessions = appSessions,
          idempotency = idempotency,
          seriesAnalysisMaintenance = Some(analysisQueueOutbox),
          now = Clock[F].realTimeInstant,
        ).evalMap { _ =>
          for
            seriesAnalysis <- PostgresSeriesAnalysisRepository.create[F](
              transactor,
              config.seriesAnalysisRead,
            )
            cachedMembers <- CachedReferenceRepositories.members(members)
            cachedGameTitles <- CachedReferenceRepositories.gameTitles(gameTitles)
            cachedMapMasters <- CachedReferenceRepositories.mapMasters(mapMasters)
            cachedSeasonMasters <- CachedReferenceRepositories.seasonMasters(seasonMasters)
            cachedIncidentMasters <- CachedReferenceRepositories.incidentMasters(incidentMasters)
            cachedMemberAliases <- CachedReferenceRepositories.memberAliases(memberAliases)
            runtime <- UseCaseWiring.assemble(
              config = config,
              storage = UseCaseWiring.RuntimeStorage(
                imageStorage = imageStorage.store,
                imageStorageInspector = imageStorage.inspector,
              ),
              repositories = UseCaseWiring.RuntimeRepositories(
                imageReferences = imageReferences,
                ocrJobCreationStore = ocrJobCreationStore,
                jobs = jobs,
                drafts = drafts,
                heldEvents = heldEvents,
                heldEventDeletion = heldEventDeletion,
                matches = matches,
                matchDrafts = matchDrafts,
                matchDraftCancellation = matchDraftCancellation,
                matchList = matchList,
                seriesAnalysis = seriesAnalysis,
                matchConfirmation = matchConfirmation,
                appSessions = appSessions,
                sessionAccounts = sessionAccounts,
                members = cachedMembers,
                loginAccounts = loginAccounts,
                loginAccountAdministration = loginAccountAdministration,
                gameTitles = cachedGameTitles,
                mapMasters = cachedMapMasters,
                seasonMasters = cachedSeasonMasters,
                incidentMasters = cachedIncidentMasters,
                memberAliases = cachedMemberAliases,
                idempotency = idempotency,
              ),
              services = UseCaseWiring.RuntimeServices(
                healthDetails = health,
                ocrQueueSubmitter = OcrJobQueueSubmitter.outboxBacked[F](ocrQueueOutbox, queue),
                ocrAdmissionGuard = ocrAdmissionGuard,
                oauthClient = oauthClient,
                loginRateLimiter = infrastructure.loginRateLimiter,
                authCallbackStateRateLimiter = infrastructure.authCallbackStateRateLimiter,
                oauthProviderBackoff = infrastructure.oauthProviderBackoff,
                rateLimiters = infrastructure.rateLimiters,
              ),
            )
          yield runtime
        }
      }
    }
  }

  private final case class RuntimeImageStorage[F[_]](
      store: ImageStorage[F],
      inspector: ImageStorageInspector[F],
      cleaner: ImageOrphanCleaner[F],
  )

  private def imageStorageResource[F[_]: Async: SecureRandom: LoggerFactory](
      config: AppConfig,
      sourceImages: SourceImagesRepository[F],
  ): Resource[F, RuntimeImageStorage[F]] = config.sourceImageStorage match
    case SourceImageStorageConfig.Local =>
      val objects = LocalSourceImageObjectStorage[F](config.imageTmpDir.resolve("objects"))
      objectBackedImageStorageResource(
        sourceImages,
        Resource.pure[F, SourceImageObjectStorage[F]](objects),
        SourceImageObjectReconcilerConfig(
          staleStateAge = LocalStaleStateAge,
          orphanAge = config.resourceLimits.imageOrphanOlderThan,
          failedRecordRetention = LocalFailedRecordRetention,
          batchSize = LocalReconciliationBatchSize,
        ),
        objects.diskUsage,
      )
    case SourceImageStorageConfig.R2(r2) =>
      for
        credentials <- Resource.eval(
          R2Credentials.fromStrings(
            r2.credentials.accessKeyId,
            r2.credentials.secretAccessKey,
          ).leftMap(new IllegalArgumentException(_)).liftTo[F]
        )
        objectConfig <- Resource.eval(
          R2SourceImageObjectStorageConfig.create(
            endpoint = r2.endpoint,
            region = r2.region,
            bucket = r2.bucket,
            credentials = credentials,
            apiCallTimeout = r2.operationTimeout,
            apiCallAttemptTimeout = r2.attemptTimeout,
            maxAttempts = r2.maximumAttempts,
          ).leftMap(new IllegalArgumentException(_)).liftTo[F]
        )
        storage <- objectBackedImageStorageResource(
          sourceImages,
          R2SourceImageObjectStorage.resource[F](objectConfig)
            .map(objectStorage => objectStorage: SourceImageObjectStorage[F]),
          SourceImageObjectReconcilerConfig(
            staleStateAge = r2.staleStateAge,
            orphanAge = config.resourceLimits.imageOrphanOlderThan,
            failedRecordRetention = r2.failedRecordRetention,
            batchSize = r2.reconciliationBatchSize,
          ),
          Async[F].pure(None),
        )
      yield storage

  private def objectBackedImageStorageResource[F[_]: Async: SecureRandom: LoggerFactory](
      sourceImages: SourceImagesRepository[F],
      objects: Resource[F, SourceImageObjectStorage[F]],
      reconcilerConfig: SourceImageObjectReconcilerConfig,
      diskUsage: F[Option[ImageDiskUsage]],
  ): Resource[F, RuntimeImageStorage[F]] = objects.map { objectStorage =>
    val now = Clock[F].realTimeInstant
    val store = ObjectBackedImageStore[F](sourceImages, objectStorage, ImageId.fresh[F], now)
    val reconciler = SourceImageObjectReconciler[F](
      sourceImages,
      objectStorage,
      reconcilerConfig,
      now,
    )
    val maintenance = ObjectBackedImageMaintenance[F](sourceImages, reconciler, diskUsage)
    RuntimeImageStorage(store, maintenance, maintenance)
  }

  private val LocalStaleStateAge = 60.seconds
  private val LocalFailedRecordRetention = 60.minutes
  private val LocalReconciliationBatchSize = 100
