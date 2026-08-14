package momo.api.bootstrap

import cats.effect.std.SecureRandom
import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.slf4j.Slf4jFactory

import momo.api.adapters.inmemory.*
import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.auth.{DiscordOAuthClient, MemberRoster}
import momo.api.config.AppConfig
import momo.api.domain.{LoginAccount, Member}
import momo.api.ports.queue.OcrJobQueuePublisher
import momo.api.repositories.{
  ImageReferenceRepository,
  OcrJobMaintenanceRepository,
  SessionAccountLookup
}
import momo.api.usecases.ocr.{OcrAdmissionGuard, OcrJobQueueSubmitter}

private[bootstrap] object InMemoryApiRuntime:
  private final case class RuntimeParts[F[_]](
      repositories: UseCaseWiring.RuntimeRepositories[F],
      ocrQueueSubmitter: OcrJobQueueSubmitter[F],
      ocrAdmissionGuard: OcrAdmissionGuard[F],
      ocrMaintenance: OcrJobMaintenanceRepository[F],
  )

  def resource[F[_]: Async: SecureRandom](
      config: AppConfig,
      oauthClient: DiscordOAuthClient[F],
  ): Resource[F, ApiApp.Runtime[F]] = RuntimeInfrastructure
    .resource[F](config, Clock[F].realTimeInstant)
    .flatMap { infrastructure =>
      given LoggerFactory[F] = Slf4jFactory.create[F]
      val imageStore = LocalFsImageStore[F](config.imageTmpDir)

      Resource.eval(createParts[F](config, infrastructure.queue)).flatMap { parts =>
        val health =
          RuntimeHealthDetails.build[F](
            None,
            config.redis.map(_ => infrastructure.queueHealth.ping),
            None
          )
        RuntimeMaintenance.resource(
          config = config,
          imageStore = imageStore,
          imageReferences = parts.repositories.imageReferences,
          ocrMaintenance = parts.ocrMaintenance,
          appSessions = parts.repositories.appSessions,
          idempotency = parts.repositories.idempotency,
          seriesAnalysisMaintenance = None,
          now = Clock[F].realTimeInstant,
        ).evalMap { _ =>
          UseCaseWiring.assemble(
            config = config,
            storage = UseCaseWiring.RuntimeStorage(
              imageStorage = imageStore,
              imageStorageInspector = imageStore,
            ),
            repositories = parts.repositories,
            services = UseCaseWiring.RuntimeServices(
              healthDetails = health,
              ocrQueueSubmitter = parts.ocrQueueSubmitter,
              ocrAdmissionGuard = parts.ocrAdmissionGuard,
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

  private def createParts[F[_]: Async: LoggerFactory](
      config: AppConfig,
      queue: OcrJobQueuePublisher[F],
  ): F[RuntimeParts[F]] =
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
      matchExports = matchesBase
      matchList = InMemoryMatchListReadModel[F](
        matches,
        matchDrafts,
        ocrJobs = Some(jobs),
        ocrDrafts = Some(drafts),
      )
      matchConfirmation = InMemoryMatchConfirmationRepository[F](
        matches,
        matchesBase.create,
        matchDrafts,
      )
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
      sessionAccounts = SessionAccountLookup.fromRepositories[F](appSessions, loginAccounts)
      loginAccountAdministration =
        InMemoryLoginAccountAdministrationRepository[F](loginAccounts, appSessions)
      mapMasters <- InMemoryMapMastersRepository.createWithDeleteGuard[F](mapMasterId =>
        InMemoryMasterDeleteGuards.ensureMapMasterCanDelete(mapMasterId, matches, matchDrafts)
      )
      seasonMasters <- InMemorySeasonMastersRepository.createWithDeleteGuard[F](seasonMasterId =>
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
      seriesAnalysis <- InMemorySeriesAnalysisRepository.create[F](
        gameTitles,
        Clock[F].realTimeInstant,
      )
      incidentMasters <- InMemoryIncidentMastersRepository.create[F]
      memberAliases <- InMemoryMemberAliasesRepository.create[F]
      idempotency <- InMemoryIdempotencyRepository.create[F]
      ocrJobCreationStore = InMemoryOcrJobCreationStore[F](
        drafts,
        drafts.create,
        jobs,
        jobs.create,
        matchDrafts,
        jobs.existsActiveByDraft,
      )
      imageReferences: ImageReferenceRepository[F] =
        InMemoryImageReferenceRepository[F](jobs, matchDrafts)
      ocrQueueSubmitter = OcrJobQueueSubmitter.direct[F](jobs, matchDrafts, queue)
      ocrAdmissionGuard = OcrAdmissionGuard.allowAll[F]
      repositories = UseCaseWiring.RuntimeRepositories(
        imageReferences = imageReferences,
        ocrJobCreationStore = ocrJobCreationStore,
        jobs = jobs,
        drafts = drafts,
        heldEvents = heldEvents,
        heldEventDeletion = heldEventDeletion,
        matches = matches,
        matchExports = matchExports,
        matchDrafts = matchDrafts,
        matchDraftCancellation = matchDraftCancellation,
        matchList = matchList,
        seriesAnalysis = seriesAnalysis,
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
      )
    yield RuntimeParts(
      repositories = repositories,
      ocrQueueSubmitter = ocrQueueSubmitter,
      ocrAdmissionGuard = ocrAdmissionGuard,
      ocrMaintenance = new InMemoryOcrJobMaintenanceRepository[F],
    )
