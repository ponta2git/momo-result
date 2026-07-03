package momo.api.bootstrap

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.slf4j.Slf4jFactory

import momo.api.adapters.postgres.*
import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.auth.DiscordOAuthClient
import momo.api.config.{AppConfig, DatabaseConfig}
import momo.api.db.Database
import momo.api.repositories.*
import momo.api.usecases.ocr.*

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
    val heldEvents: HeldEventsRepository[F] = PostgresHeldEventsRepository[F](transactor)
    val heldEventDeletion: HeldEventDeletionRepository[F] =
      PostgresHeldEventDeletionRepository[F](transactor)
    val matches: MatchesRepository[F] = PostgresMatchesRepository[F](transactor)
    val matchDrafts: MatchDraftsRepository[F] = PostgresMatchDraftsRepository[F](transactor)
    val matchDraftCancellation: MatchDraftCancellationRepository[F] =
      PostgresMatchDraftCancellationRepository[F](transactor)
    val matchList: MatchListReadModel[F] = PostgresMatchListReadModel[F](transactor)
    val seriesComparison: SeriesComparisonReadModel[F] =
      PostgresSeriesComparisonReadModel[F](transactor)
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
    val imageStore = LocalFsImageStore[F](config.imageTmpDir)
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

    OcrQueueOutboxDispatcher.resource[F](
      ocrQueueOutbox,
      queue,
      OcrQueueOutboxDispatcherConfig(pollInterval =
        config.resourceLimits.ocrOutboxRecoveryInterval
      ),
    ).flatMap { _ =>
      RuntimeMaintenance.resource(
        config = config,
        imageStore = imageStore,
        imageReferences = imageReferences,
        ocrMaintenance = ocrMaintenance,
        appSessions = appSessions,
        idempotency = idempotency,
        now = Clock[F].realTimeInstant,
      ).evalMap { _ =>
        UseCaseWiring.assemble(
          config = config,
          storage = UseCaseWiring.RuntimeStorage(
            imageStorage = imageStore,
            imageStorageInspector = imageStore,
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
            seriesComparison = seriesComparison,
            matchConfirmation = matchConfirmation,
            appSessions = appSessions,
            sessionAccounts = sessionAccounts,
            members = members,
            loginAccounts = loginAccounts,
            loginAccountAdministration = loginAccountAdministration,
            gameTitles = gameTitles,
            mapMasters = mapMasters,
            seasonMasters = seasonMasters,
            incidentMasters = incidentMasters,
            memberAliases = memberAliases,
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
      }
    }
  }
