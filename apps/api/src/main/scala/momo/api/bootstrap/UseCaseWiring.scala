package momo.api.bootstrap

import java.time.Instant

import cats.Apply
import cats.effect.std.{Random, SecureRandom}
import cats.effect.{Async, Clock, Sync}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.adapters.LocalFsImageStore
import momo.api.auth.{
  CsrfTokenService,
  DiscordOAuthClient,
  MemberRoster,
  OAuthProviderBackoff,
  OAuthStateCodec,
  RateLimiter,
  SessionService
}
import momo.api.config.{AppConfig, AuthConfig, ResourceLimitsConfig}
import momo.api.domain.ids.*
import momo.api.endpoints.HealthEndpoints.HealthDetailsResponse
import momo.api.http.{HttpRateLimiters, HttpRoutes}
import momo.api.repositories.*
import momo.api.usecases.*

private[bootstrap] object UseCaseWiring:
  private final case class RuntimeClock[F[_]](now: F[Instant])

  private object RuntimeClock:
    def live[F[_]: Clock]: RuntimeClock[F] = RuntimeClock(Clock[F].realTimeInstant)

  private final case class RuntimeIds[F[_]](
      nextOcrJobId: F[OcrJobId],
      nextOcrDraftId: F[OcrDraftId],
      nextHeldEventId: F[HeldEventId],
      nextMatchDraftId: F[MatchDraftId],
      nextMatchId: F[MatchId],
      nextMemberAliasId: F[MemberAliasId],
      nextLoginAccountId: F[AccountId],
  )

  private object RuntimeIds:
    def fresh[F[_]: Apply: Random]: RuntimeIds[F] =
      val nextOcrJobId = OcrJobId.fresh[F]
      val nextOcrDraftId = OcrDraftId.fresh[F]
      val nextHeldEventId = HeldEventId.fresh[F]
      val nextMatchDraftId = MatchDraftId.fresh[F]
      val nextMatchId = MatchId.fresh[F]
      val nextMemberAliasId = MemberAliasId.fresh[F]
      val nextLoginAccountId = AccountId.fresh[F]
      RuntimeIds(
        nextOcrJobId = nextOcrJobId,
        nextOcrDraftId = nextOcrDraftId,
        nextHeldEventId = nextHeldEventId,
        nextMatchDraftId = nextMatchDraftId,
        nextMatchId = nextMatchId,
        nextMemberAliasId = nextMemberAliasId,
        nextLoginAccountId = nextLoginAccountId,
      )

  private final case class RuntimeAuthServices[F[_]](
      sessionService: SessionService[F],
      csrfTokenService: CsrfTokenService,
      oauthStateCodec: OAuthStateCodec[F],
  )

  private object RuntimeAuthServices:
    def from[F[_]: Sync: SecureRandom](
        sessions: AppSessionsRepository[F],
        accounts: LoginAccountsRepository[F],
        config: AuthConfig,
        clock: RuntimeClock[F],
    ): RuntimeAuthServices[F] = RuntimeAuthServices(
      sessionService = SessionService[F](sessions, accounts, config, clock.now),
      csrfTokenService = CsrfTokenService(),
      oauthStateCodec = OAuthStateCodec[F](config, clock.now),
    )

  private def imageStorageAdmissionConfig(
      limits: ResourceLimitsConfig
  ): ImageStorageAdmission.Config = ImageStorageAdmission.Config(
    unreferencedCountLimit = limits.imageUploadUnreferencedCountLimit,
    unreferencedBytesLimit = limits.imageUploadUnreferencedBytesLimit,
    storageMinFreeBytes = limits.imageUploadStorageMinFreeBytes,
    storageMaxUsedPercent = limits.imageUploadStorageMaxUsedPercent,
  )

  private def exportMatchLimits(limits: ResourceLimitsConfig): ExportMatches.Limits = ExportMatches
    .Limits(maxRows = limits.exportMaxRows, maxBytes = limits.exportMaxBytes)

  def assemble[F[_]: Async: SecureRandom: LoggerFactory](
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
      matchDraftCancellation: MatchDraftCancellationRepository[F],
      matchList: MatchListReadModel[F],
      seriesComparison: SeriesComparisonReadModel[F],
      matchConfirmation: MatchConfirmationRepository[F],
      appSessions: AppSessionsRepository[F],
      members: MembersRepository[F],
      loginAccounts: LoginAccountsRepository[F],
      loginAccountAdministration: LoginAccountAdministrationRepository[F],
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
  ): F[ApiApp.Runtime[F]] =
    val clock = RuntimeClock.live[F]
    val ids = RuntimeIds.fresh[F]
    val authServices = RuntimeAuthServices.from[F](appSessions, loginAccounts, config.auth, clock)
    val imageStorageAdmission = ImageStorageAdmission
      .from[F](imageStore, imageReferences, imageStorageAdmissionConfig(config.resourceLimits))
    val uploadImage = UploadImage[F](imageStore, imageStorageAdmission)
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStore,
      creation = ocrJobCreation,
      matchDrafts = matchDrafts,
      queueSubmitter = ocrQueueSubmitter,
      admissionGuard = ocrAdmissionGuard,
      now = clock.now,
      nextJobId = ids.nextOcrJobId,
      nextDraftId = ids.nextOcrDraftId,
      memberAliases = memberAliases,
      activeJobLimit = config.resourceLimits.ocrActiveJobLimit,
    )
    val getOcrJob = GetOcrJob[F](jobs)
    val getOcrDraft = GetOcrDraft[F](drafts)
    val getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts)
    val cancelOcrJob = CancelOcrJob[F](jobs, clock.now)
    val listHeldEvents = ListHeldEvents[F](heldEvents, matches)
    val createHeldEvent = CreateHeldEvent[F](heldEvents, ids.nextHeldEventId)
    val sourceImageRetention = PurgeSourceImages[F](matchDrafts, imageStore)
    val createMatchDraft = CreateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = clock.now,
      nextId = ids.nextMatchDraftId,
    )
    val getMatchDraft = GetMatchDraft[F](matchDrafts)
    val updateMatchDraft = UpdateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = clock.now,
    )
    val cancelMatchDraft =
      CancelMatchDraft[F](matchDraftCancellation, sourceImageRetention, clock.now)
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
      now = clock.now,
      nextId = ids.nextMatchId,
      allowedMemberIds = members.list.map(_.map(_.id).toSet),
    )
    val listMatches = ListMatches[F](matchList)
    val getSeriesComparisonOptions = GetSeriesComparisonOptions[F](seriesComparison)
    val getSeriesComparison = GetSeriesComparison[F](seriesComparison)
    val getSeriesComparisonReview = GetSeriesComparisonReview[F](seriesComparison)
    val getSeriesComparisonDrilldown = GetSeriesComparisonDrilldown[F](seriesComparison)
    val exportMatches = ExportMatches[F](
      matches,
      members,
      mapMasters,
      seasonMasters,
      exportMatchLimits(config.resourceLimits),
    )
    val getMatch = GetMatch[F](matches)
    val updateMatch = UpdateMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = clock.now,
      allowedMemberIds = members.list.map(_.map(_.id).toSet),
    )
    val deleteMatch = DeleteMatch[F](matches)
    val deleteHeldEvent = DeleteHeldEvent[F](heldEventDeletion)
    val listGameTitles = ListGameTitles[F](gameTitles)
    val listMapMasters = ListMapMasters[F](mapMasters)
    val listSeasonMasters = ListSeasonMasters[F](seasonMasters)
    val listIncidentMasters = ListIncidentMasters[F](incidentMasters)
    val createGameTitle = CreateGameTitle[F](gameTitles, clock.now)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, clock.now)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, clock.now)
    val updateGameTitle = UpdateGameTitle[F](gameTitles)
    val updateMapMaster = UpdateMapMaster[F](mapMasters)
    val updateSeasonMaster = UpdateSeasonMaster[F](seasonMasters)
    val deleteGameTitle = DeleteGameTitle[F](gameTitles)
    val deleteMapMaster = DeleteMapMaster[F](mapMasters)
    val deleteSeasonMaster = DeleteSeasonMaster[F](seasonMasters)
    val listMemberAliases = ListMemberAliases[F](memberAliases)
    val createMemberAlias =
      CreateMemberAlias[F](memberAliases, members, clock.now, ids.nextMemberAliasId)
    val updateMemberAlias = UpdateMemberAlias[F](memberAliases, members)
    val deleteMemberAlias = DeleteMemberAlias[F](memberAliases)
    val listLoginAccounts = ListLoginAccounts[F](loginAccounts)
    val createLoginAccount =
      CreateLoginAccount[F](loginAccounts, members, clock.now, ids.nextLoginAccountId)
    val updateLoginAccount = UpdateLoginAccount[F](loginAccountAdministration, members, clock.now)

    MemberRoster.devFromMemberIds(config.devMemberIds).leftMap(new IllegalArgumentException(_))
      .liftTo[F].map { roster =>
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
          getSeriesComparisonOptions = getSeriesComparisonOptions,
          getSeriesComparison = getSeriesComparison,
          getSeriesComparisonReview = getSeriesComparisonReview,
          getSeriesComparisonDrilldown = getSeriesComparisonDrilldown,
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
          sessionService = authServices.sessionService,
          csrfTokenService = authServices.csrfTokenService,
          oauthStateCodec = authServices.oauthStateCodec,
          loginRateLimiter = loginRateLimiter,
          authCallbackStateRateLimiter = authCallbackStateRateLimiter,
          oauthProviderBackoff = oauthProviderBackoff,
          rateLimiters = rateLimiters,
          idempotency = idempotency,
          healthDetails = healthDetails,
          nowF = clock.now,
        ))
        ApiApp.Runtime(
          app,
          gameTitles,
          mapMasters,
          seasonMasters,
          idempotency,
          loginAccounts,
          authServices.sessionService.create,
        )
      }
