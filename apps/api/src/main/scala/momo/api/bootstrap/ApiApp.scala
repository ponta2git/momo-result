package momo.api.bootstrap

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import org.http4s.HttpApp as Http4sApp
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.slf4j.Slf4jFactory

import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.adapters.inmemory.*
import momo.api.auth.{CreatedSession, DiscordOAuthClient, JavaDiscordOAuthClient, MemberRoster}
import momo.api.config.{AppConfig, ResourceLimitsConfig}
import momo.api.db.Database
import momo.api.domain.{LoginAccount, Member}
import momo.api.adapters.postgres.*
import momo.api.repositories.{
  AppSessionsRepository,
  GameTitlesRepository,
  HeldEventDeletionRepository,
  HeldEventsRepository,
  IdempotencyRepository,
  ImageReferenceRepository,
  IncidentMastersRepository,
  LoginAccountAdministrationRepository,
  LoginAccountsRepository,
  MapMastersRepository,
  MatchConfirmationRepository,
  MatchDraftCancellationRepository,
  MatchDraftsRepository,
  MatchListReadModel,
  MatchesRepository,
  MemberAliasesRepository,
  MembersRepository,
  OcrDraftsRepository,
  OcrJobCreationRepository,
  OcrJobMaintenanceRepository,
  OcrJobsRepository,
  SeasonMastersRepository,
  SeriesComparisonReadModel
}
import momo.api.usecases.ocr.*

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
        RuntimeInfrastructure.resource[F](config, Clock[F].realTimeInstant),
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
        val matchDraftCancellation: MatchDraftCancellationRepository[F] =
          PostgresMatchDraftCancellationRepository[F](transactor)
        val matchList: MatchListReadModel[F] = PostgresMatchListReadModel[F](transactor)
        val seriesComparison: SeriesComparisonReadModel[F] =
          PostgresSeriesComparisonReadModel[F](transactor)
        val matchConfirmation: MatchConfirmationRepository[F] =
          PostgresMatchConfirmationRepository[F](transactor)
        val appSessions: AppSessionsRepository[F] = PostgresAppSessionsRepository[F](transactor)
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
          ocrAdmissionGuardConfig(config.resourceLimits),
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
              imageStorage = imageStore,
              imageStorageInspector = imageStore,
              imageReferences = imageReferences,
              healthDetails = health,
              ocrQueueSubmitter = OcrJobQueueSubmitter.outboxBacked[F](ocrQueueOutbox, queue),
              ocrAdmissionGuard = ocrAdmissionGuard,
              ocrJobCreation = ocrJobCreation,
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
              members = members,
              loginAccounts = loginAccounts,
              loginAccountAdministration = loginAccountAdministration,
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
    case None => RuntimeInfrastructure.resource[F](config, Clock[F].realTimeInstant)
        .flatMap { infrastructure =>
          val queue = infrastructure.queue
          given LoggerFactory[F] = Slf4jFactory.create[F]
          Resource.eval(
            for
              matchDrafts <- InMemoryMatchDraftsRepository.create[F]
              jobs <- InMemoryOcrJobsRepository.createWithDraftCancelSync[F](matchDrafts)
              matchDraftCancellation =
                InMemoryMatchDraftCancellationRepository[F](matchDrafts, jobs)
              drafts <- InMemoryOcrDraftsRepository.create[F]
              heldEvents <- InMemoryHeldEventsRepository.create[F]
              matchesBase <- InMemoryMatchesRepository.create[F]
              matches = InMemoryMatchesRepository
                .withConfirmedDraftCleanup[F](matchesBase, matchDrafts)
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
              devIdentities <- MemberRoster.devIdentities(config.devMemberIds)
                .leftMap(new IllegalArgumentException(_)).liftTo[F]
              members <- InMemoryMembersRepository.create[F](devIdentities.map(identity =>
                Member(
                  identity.memberId,
                  identity.userId,
                  identity.displayName,
                  java.time.Instant.EPOCH,
                )
              ))
              loginAccounts <- InMemoryLoginAccountsRepository
                .create[F](devIdentities.map { identity =>
                  LoginAccount(
                    identity.accountId,
                    identity.userId,
                    identity.displayName,
                    Some(identity.memberId),
                    loginEnabled = true,
                    isAdmin = identity.isAdmin,
                    createdAt = java.time.Instant.EPOCH,
                    updatedAt = java.time.Instant.EPOCH,
                  )
                })
              loginAccountAdministration =
                InMemoryLoginAccountAdministrationRepository[F](loginAccounts, appSessions)
              mapMasters <- InMemoryMapMastersRepository.createWithDeleteGuard[F](mapMasterId =>
                InMemoryMasterDeleteGuards.ensureMapMasterCanDelete(
                  mapMasterId,
                  matches,
                  matchDrafts
                )
              )
              seasonMasters <- InMemorySeasonMastersRepository
                .createWithDeleteGuard[F](seasonMasterId =>
                  InMemoryMasterDeleteGuards.ensureSeasonMasterCanDelete(
                    seasonMasterId,
                    matches,
                    matchDrafts
                  )
                )
              gameTitles <- InMemoryGameTitlesRepository.createWithDeleteGuard[F](gameTitleId =>
                InMemoryMasterDeleteGuards.ensureGameTitleCanDelete(
                  gameTitleId,
                  mapMasters,
                  seasonMasters,
                  matches,
                  matchDrafts,
                )
              )
              seriesComparison = InMemorySeriesComparisonReadModel[F](
                gameTitles,
                mapMasters,
                seasonMasters,
                members,
                matches,
              )
              incidentMasters <- InMemoryIncidentMastersRepository.create[F]
              memberAliases <- InMemoryMemberAliasesRepository.create[F]
              idempotency <- InMemoryIdempotencyRepository.create[F]
              ocrJobCreation = InMemoryOcrJobCreationRepository[F](
                drafts,
                jobs,
                matchDrafts,
                jobs.existsActiveByDraft,
              )
              ocrQueueSubmitter = OcrJobQueueSubmitter.direct[F](jobs, matchDrafts, queue)
              ocrAdmissionGuard = OcrAdmissionGuard.allowAll[F]
            yield (
              jobs,
              drafts,
              heldEvents,
              matches,
              matchDrafts,
              matchDraftCancellation,
              heldEventDeletion,
              matchList,
              seriesComparison,
              matchConfirmation,
              appSessions,
              members,
              loginAccounts,
              loginAccountAdministration,
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
                  matchDraftCancellation,
                  heldEventDeletion,
                  matchList,
                  seriesComparison,
                  matchConfirmation,
                  appSessions,
                  members,
                  loginAccounts,
                  loginAccountAdministration,
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
                InMemoryImageReferenceRepository[F](jobs, matchDrafts)
              val ocrMaintenance: OcrJobMaintenanceRepository[F] =
                new InMemoryOcrJobMaintenanceRepository[F]
              val health =
                RuntimeHealthDetails.build[F](
                  None,
                  config.redis.map(_ => infrastructure.queueHealth.ping),
                  None
                )
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
                  imageStorage = imageStore,
                  imageStorageInspector = imageStore,
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
                  matchDraftCancellation = matchDraftCancellation,
                  matchList = matchList,
                  seriesComparison = seriesComparison,
                  matchConfirmation = matchConfirmation,
                  appSessions = appSessions,
                  members = members,
                  loginAccounts = loginAccounts,
                  loginAccountAdministration = loginAccountAdministration,
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

  private def ocrAdmissionGuardConfig(limits: ResourceLimitsConfig): OcrAdmissionGuard.Config =
    OcrAdmissionGuard.Config(
      dueBacklogLimit = limits.ocrOutboxDueBacklogLimit,
      activeBacklogLimit = limits.ocrOutboxActiveBacklogLimit,
      oldestDueMaxDelay = limits.ocrOutboxOldestDueMaxDelay,
      deadLetterBacklogLimit = limits.ocrDeadLetterBacklogLimit,
    )
