package momo.api.bootstrap

import scala.concurrent.duration.*

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Deferred, Resource}
import cats.syntax.all.*
import doobie.implicits.*
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
  SourceImageObjectStorage
}
import momo.api.repositories.*
import momo.api.usecases.images.ImageStorageAdmission
import momo.api.usecases.ocr.*
import momo.api.usecases.queue.{WorkerWakeKind, WorkerWakeRelay, WorkerWakeup}

private[bootstrap] object PostgresApiRuntime:
  def resource[F[_]: Async: SecureRandom](
      config: AppConfig,
      db: DatabaseConfig,
      oauthClient: DiscordOAuthClient[F],
  ): Resource[F, ApiApp.WiredRuntime[F]] = (
    Database.transactor[F](db),
    RuntimeInfrastructure.resource[F](config, Clock[F].realTimeInstant),
  ).tupled.evalMap { (transactor, infrastructure) =>
    (for
      identities <- PostgresIdentities.discover
      publicIds <- PostgresPublicIds.discover
    yield (transactor, infrastructure, publicIds, identities)).transact(transactor)
  }.flatMap { (transactor, infrastructure, publicIds, identities) =>
    given LoggerFactory[F] = Slf4jFactory.create[F]
    val oauthStateReplayGuard = new PostgresOAuthStateReplayGuard[F](transactor)
    val jobsBase: OcrJobsRepository[F] =
      PostgresOcrJobsRepository[F](transactor, identities = identities)
    val drafts: OcrDraftsRepository[F] =
      PostgresOcrDraftsRepository[F](transactor, identities = identities)
    val ocrJobCreationStoreBase: OcrJobCreationStore[F] =
      PostgresOcrJobCreationStore[F](transactor, identities = identities)
    val jobNotifier =
      PostgresWorkerNotifier[F](transactor, PostgresWorkerNotifier.Channel.ProcessingJobs)
    val submissionNotifier =
      PostgresWorkerNotifier[F](transactor, PostgresWorkerNotifier.Channel.OcrSubmissions)
    val heldEvents: HeldEventsRepository[F] =
      PostgresHeldEventsRepository[F](transactor, publicIds, identities)
    val heldEventDeletion: HeldEventDeletionRepository[F] =
      PostgresHeldEventDeletionRepository[F](transactor, identities = identities)
    val matchesBase: MatchesRepository[F] =
      PostgresMatchesRepository[F](transactor, identities = identities)
    val matchNotes: MatchNotesRepository[F] =
      PostgresMatchNotesRepository[F](transactor, identities = identities)
    val matchExports: MatchExportsRepository[F] =
      PostgresMatchExportsRepository[F](transactor, identities = identities)
    val matchDrafts: MatchDraftsRepository[F] =
      PostgresMatchDraftsRepository[F](transactor, identities = identities)
    val matchDraftCancellation: MatchDraftCancellationRepository[F] =
      PostgresMatchDraftCancellationRepository[F](transactor, identities = identities)
    val matchList: MatchListReadModel[F] =
      PostgresMatchListReadModel[F](transactor, publicIds, identities)
    val matchConfirmationBase: MatchConfirmationRepository[F] =
      PostgresMatchConfirmationRepository[F](transactor, identities = identities)
    val appSessions: AppSessionsRepository[F] =
      PostgresAppSessionsRepository[F](transactor, identities = identities)
    val sessionAccounts: SessionAccountLookup[F] =
      PostgresSessionAccountLookup[F](transactor, identities = identities)
    val members: MembersRepository[F] =
      PostgresMembersRepository[F](transactor, identities = identities)
    val loginAccounts: LoginAccountsRepository[F] =
      PostgresLoginAccountsRepository[F](transactor, identities = identities)
    val loginAccountAdministration =
      PostgresLoginAccountAdministrationRepository[F](transactor, identities = identities)
    val gameTitles: GameTitlesRepository[F] =
      PostgresGameTitlesRepository[F](transactor, identities = identities)
    val mapMasters: MapMastersRepository[F] =
      PostgresMapMastersRepository[F](transactor, identities = identities)
    val seasonMasters: SeasonMastersRepository[F] =
      PostgresSeasonMastersRepository[F](transactor, identities = identities)
    val incidentMasters: IncidentMastersRepository[F] =
      PostgresIncidentMastersRepository[F](transactor, identities = identities)
    val memberAliases: MemberAliasesRepository[F] =
      PostgresMemberAliasesRepository[F](transactor, identities = identities)
    val idempotency: IdempotencyRepository[F] =
      PostgresIdempotencyRepository[F](transactor, identities = identities)
    val sourceImages: SourceImagesRepository[F] =
      PostgresSourceImagesRepository[F](transactor, identities = identities)
    val ocrAdmissionGuard = OcrAdmissionGuard.from[F](
      jobsBase.backlogSnapshot,
      ApiApp.ocrAdmissionGuardConfig(config.resourceLimits),
    )
    val health = RuntimeHealthDetails.build[F](
      Some(Database.ping[F](transactor)),
      Some(ocrAdmissionGuard.healthStatus),
    )

    val wakeRuntime = WorkerWakeup.resource[F].flatMap { wakeup =>
      Resource.eval(Deferred[F, Throwable]).flatMap { backgroundFailure =>
        val reportCoordinatorFailure = (error: Throwable) => backgroundFailure.complete(error).void
        (
          WorkerWakeRelay.resource[F](
            WorkerWakeKind.ProcessingJobs,
            wakeup,
            jobNotifier.notifyWorker,
            reportCoordinatorFailure,
          ),
          WorkerWakeRelay.resource[F](
            WorkerWakeKind.OcrSubmissions,
            wakeup,
            submissionNotifier.notifyWorker,
            reportCoordinatorFailure,
          ),
          PostgresSeriesAnalysisReaderCapability.resource[F](transactor),
        ).tupled.as((wakeup, backgroundFailure))
      }
    }

    imageStorageResource(config, sourceImages).flatMap { imageStorage =>
      wakeRuntime.flatMap { (workerWakeup, backgroundFailure) =>
        val signalBackgroundFailure = backgroundFailure
          .complete(new WorkerWakeRuntimeFailure).void
        val jobs = WorkerWakingRepositories.ocrJobs(
          jobsBase,
          workerWakeup,
          signalBackgroundFailure,
        )
        val ocrSubmissions = WorkerWakingRepositories.ocrSubmissions(
          PostgresOcrSubmissionsRepository[F](transactor, identities = identities),
          workerWakeup,
          signalBackgroundFailure,
        )
        val ocrJobCreationStore = WorkerWakingRepositories.ocrJobCreation(
          ocrJobCreationStoreBase,
          workerWakeup,
          signalBackgroundFailure,
        )
        val matches = WorkerWakingRepositories.matches(
          matchesBase,
          workerWakeup,
          signalBackgroundFailure,
        )
        val matchConfirmation = WorkerWakingRepositories.matchConfirmation(
          matchConfirmationBase,
          workerWakeup,
          signalBackgroundFailure,
        )
        RuntimeMaintenance.resource(
          config = config,
          imageOrphanCleaner = imageStorage.cleaner,
          appSessions = appSessions,
          idempotency = idempotency,
          oauthStateCleanup = oauthStateReplayGuard.deleteExpired,
          now = Clock[F].realTimeInstant,
        ).evalMap { _ =>
          for
            seriesAnalysis <- PostgresSeriesAnalysisRepository.create[F](
              transactor,
              config.seriesAnalysisRead,
              identities,
            )
            wakingSeriesAnalysis = WorkerWakingRepositories.seriesAnalysis(
              seriesAnalysis,
              workerWakeup,
              signalBackgroundFailure,
            )
            seriesPlayerRadar <-
              PostgresSeriesPlayerRadarRepository.create[F](
                transactor,
                config.seriesAnalysisRead,
                identities
              )
            wakingSeriesPlayerRadar = WorkerWakingRepositories.seriesPlayerRadar(
              seriesPlayerRadar,
              workerWakeup,
              signalBackgroundFailure,
            )
            cachedMembers <- CachedReferenceRepositories.members(members)
            cachedGameTitles <- CachedReferenceRepositories.gameTitles(gameTitles)
            cachedMapMasters <- CachedReferenceRepositories.mapMasters(
              WorkerWakingRepositories.mapMasters(mapMasters, workerWakeup, signalBackgroundFailure)
            )
            cachedSeasonMasters <- CachedReferenceRepositories.seasonMasters(seasonMasters)
            cachedIncidentMasters <- CachedReferenceRepositories.incidentMasters(incidentMasters)
            cachedMemberAliases <- CachedReferenceRepositories.memberAliases(memberAliases)
            runtime <- UseCaseWiring.assemble(
              config = config,
              storage = UseCaseWiring.RuntimeStorage(
                imageStorage = imageStorage.store,
                imageStorageAdmission = imageStorage.admission,
              ),
              repositories = UseCaseWiring.RuntimeRepositories(
                ocrJobCreationStore = ocrJobCreationStore,
                ocrSubmissions = ocrSubmissions,
                jobs = jobs,
                drafts = drafts,
                heldEvents = heldEvents,
                heldEventDetails =
                  PostgresHeldEventDetailReadModel[F](transactor, publicIds, identities),
                heldEventList =
                  PostgresHeldEventListReadModel[F](transactor, publicIds, identities),
                heldEventDeletion = heldEventDeletion,
                matches = matches,
                matchDetails = PostgresMatchDetailReadModel[F](transactor, publicIds, identities),
                matchNotes = matchNotes,
                matchExports = matchExports,
                matchDrafts = matchDrafts,
                matchDraftReviews =
                  PostgresMatchDraftReviewReadModel[F](transactor, identities = identities),
                matchDraftCancellation = matchDraftCancellation,
                matchList = matchList,
                seriesAnalysis = wakingSeriesAnalysis,
                achievements = WorkerWakingRepositories.achievements(
                  PostgresAchievementsRepository[F](transactor, seriesAnalysis, identities),
                  workerWakeup,
                  signalBackgroundFailure
                ),
                seriesPlayerRadar = wakingSeriesPlayerRadar,
                matchConfirmation = matchConfirmation,
                appSessions = appSessions,
                sessionAccounts = sessionAccounts,
                sessionCreation = loginAccountAdministration,
                members = cachedMembers,
                loginAccounts = loginAccounts,
                loginAccountAdministration = loginAccountAdministration,
                notificationSettings = PostgresNotificationSettingsRepository[F](transactor),
                gameTitles = cachedGameTitles,
                mapMasters = cachedMapMasters,
                seasonMasters = cachedSeasonMasters,
                incidentMasters = cachedIncidentMasters,
                memberAliases = cachedMemberAliases,
                idempotency = idempotency,
                identityReferences =
                  Some(PostgresEntityReferenceResolver[F](transactor, identities)),
              ),
              services = UseCaseWiring.RuntimeServices(
                healthDetails = health,
                ocrAdmissionGuard = ocrAdmissionGuard,
                oauthClient = oauthClient,
                loginRateLimiter = infrastructure.loginRateLimiter,
                oauthStateReplayGuard = oauthStateReplayGuard,
                rateLimiters = infrastructure.rateLimiters,
              ),
            )
          yield runtime.copy(runtime =
            runtime.runtime.copy(
              backgroundFailure = backgroundFailure.get.flatMap(Async[F].raiseError[Nothing])
            )
          )
        }
      }
    }
  }

  private final case class RuntimeImageStorage[F[_]](
      store: ImageStorage[F],
      admission: ImageStorageAdmission[F],
      cleaner: ImageOrphanCleaner[F],
  )

  private final class WorkerWakeRuntimeFailure
      extends RuntimeException("worker wake relay stopped")

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
        UseCaseWiring.imageStorageAdmissionConfig(config.resourceLimits),
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
          UseCaseWiring.imageStorageAdmissionConfig(config.resourceLimits),
        )
      yield storage

  private def objectBackedImageStorageResource[F[_]: Async: SecureRandom: LoggerFactory](
      sourceImages: SourceImagesRepository[F],
      objects: Resource[F, SourceImageObjectStorage[F]],
      reconcilerConfig: SourceImageObjectReconcilerConfig,
      diskUsage: F[Option[ImageDiskUsage]],
      admissionConfig: ImageStorageAdmission.Config,
  ): Resource[F, RuntimeImageStorage[F]] = objects.evalMap { objectStorage =>
    val now = Clock[F].realTimeInstant
    val store = ObjectBackedImageStore[F](
      sourceImages,
      objectStorage,
      ImageId.fresh[F],
      now,
      admissionConfig.quota,
    )
    SourceImageObjectReconciler.create[F](
      sourceImages,
      objectStorage,
      reconcilerConfig,
      now,
    ).map { reconciler =>
      val maintenance = ObjectBackedImageMaintenance[F](reconciler, diskUsage)
      val admission = ImageStorageAdmission.capacityOnly[F](maintenance, admissionConfig.capacity)
      RuntimeImageStorage(store, admission, maintenance)
    }
  }

  private val LocalStaleStateAge = 60.seconds
  private val LocalFailedRecordRetention = 60.minutes
  private val LocalReconciliationBatchSize = 100
