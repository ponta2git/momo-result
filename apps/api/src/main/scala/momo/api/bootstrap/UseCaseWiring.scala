package momo.api.bootstrap

import cats.Apply
import cats.effect.std.{Random, SecureRandom}
import cats.effect.{Async, Clock, Sync}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

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
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.*
import momo.api.usecases.exports.*
import momo.api.usecases.images.*
import momo.api.usecases.ocr.*

private[bootstrap] object UseCaseWiring:
  private[bootstrap] final case class RuntimeIds[F[_]](
      nextOcrJobId: F[OcrJobId],
      nextOcrDraftId: F[OcrDraftId],
      nextHeldEventId: F[HeldEventId],
      nextMatchDraftId: F[MatchDraftId],
      nextMatchId: F[MatchId],
      nextMemberAliasId: F[MemberAliasId],
      nextLoginAccountId: F[AccountId],
  )

  private[bootstrap] object RuntimeIds:
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

  private[bootstrap] final case class RuntimeAuthServices[F[_]](
      sessionService: SessionService[F],
      csrfTokenService: CsrfTokenService,
      oauthStateCodec: OAuthStateCodec[F],
  )

  private[bootstrap] object RuntimeAuthServices:
    def from[F[_]: Sync: SecureRandom](
        sessions: AppSessionsRepository[F],
        sessionAccounts: SessionAccountLookup[F],
        config: AuthConfig,
        now: F[java.time.Instant],
    ): RuntimeAuthServices[F] = RuntimeAuthServices(
      sessionService = SessionService[F](sessions, config, now, sessionAccounts),
      csrfTokenService = CsrfTokenService(),
      oauthStateCodec = OAuthStateCodec[F](config, now),
    )

  private[bootstrap] def imageStorageAdmissionConfig(
      limits: ResourceLimitsConfig
  ): ImageStorageAdmission.Config = ImageStorageAdmission.Config(
    unreferencedCountLimit = limits.imageUploadUnreferencedCountLimit,
    unreferencedBytesLimit = limits.imageUploadUnreferencedBytesLimit,
    storageMinFreeBytes = limits.imageUploadStorageMinFreeBytes,
    storageMaxUsedPercent = limits.imageUploadStorageMaxUsedPercent,
  )

  private[bootstrap] def exportMatchLimits(limits: ResourceLimitsConfig): ExportMatches.Limits =
    ExportMatches
      .Limits(maxRows = limits.exportMaxRows, maxBytes = limits.exportMaxBytes)

  final case class RuntimeStorage[F[_]](
      imageStorage: ImageStorage[F],
      imageStorageAdmission: ImageStorageAdmission[F],
  )

  final case class RuntimeRepositories[F[_]](
      ocrJobCreationStore: OcrJobCreationStore[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      heldEvents: HeldEventsRepository[F],
      heldEventDeletion: HeldEventDeletionRepository[F],
      matches: MatchesRepository[F],
      matchNotes: MatchNotesRepository[F],
      matchExports: MatchExportsRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      matchDraftCancellation: MatchDraftCancellationRepository[F],
      matchList: MatchListReadModel[F],
      seriesAnalysis: SeriesAnalysisRepository[F],
      matchConfirmation: MatchConfirmationRepository[F],
      appSessions: AppSessionsRepository[F],
      sessionAccounts: SessionAccountLookup[F],
      members: MembersRepository[F],
      loginAccounts: LoginAccountsRepository[F],
      loginAccountAdministration: LoginAccountAdministrationRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      memberAliases: MemberAliasesRepository[F],
      idempotency: IdempotencyRepository[F],
  )

  final case class RuntimeServices[F[_]](
      healthDetails: F[HealthDetailsResponse],
      ocrQueueSubmitter: OcrJobQueueSubmitter[F],
      ocrAdmissionGuard: OcrAdmissionGuard[F],
      oauthClient: DiscordOAuthClient[F],
      loginRateLimiter: RateLimiter[F],
      authCallbackStateRateLimiter: RateLimiter[F],
      oauthProviderBackoff: OAuthProviderBackoff[F],
      rateLimiters: HttpRateLimiters[F],
  )

  def assemble[F[_]: Async: SecureRandom: LoggerFactory](
      config: AppConfig,
      storage: RuntimeStorage[F],
      repositories: RuntimeRepositories[F],
      services: RuntimeServices[F],
  ): F[ApiApp.WiredRuntime[F]] =
    val now = Clock[F].realTimeInstant
    val ids = RuntimeIds.fresh[F]
    val authServices =
      RuntimeAuthServices.from[F](
        repositories.appSessions,
        repositories.sessionAccounts,
        config.auth,
        now,
      )
    val routeUseCases = UseCaseRouteBundles.from[F](
      config = config,
      storage = storage,
      repositories = repositories,
      services = services,
      now = now,
      ids = ids,
    )

    MemberRoster.devFromMemberIds(config.devMemberIds).leftMap(new IllegalArgumentException(_))
      .liftTo[F].map { roster =>
        val authDependencies = HttpRoutes.AuthDependencies(
          roster = roster,
          loginAccounts = repositories.loginAccounts,
          oauthClient = services.oauthClient,
          sessionService = authServices.sessionService,
          csrfTokenService = authServices.csrfTokenService,
          oauthStateCodec = authServices.oauthStateCodec,
          loginRateLimiter = services.loginRateLimiter,
          authCallbackStateRateLimiter = services.authCallbackStateRateLimiter,
          oauthProviderBackoff = services.oauthProviderBackoff,
        )
        val (app, registeredEndpoints) = HttpRoutes.routesWithEndpoints(HttpRoutes.Dependencies(
          config = config,
          auth = authDependencies,
          upload = routeUseCases.upload,
          ocr = routeUseCases.ocr,
          heldEvents = routeUseCases.heldEvents,
          matchDrafts = routeUseCases.matchDrafts,
          matches = routeUseCases.matches,
          exportMatches = routeUseCases.exportMatches,
          analytics = routeUseCases.analytics,
          masters = routeUseCases.masters,
          adminAccounts = routeUseCases.adminAccounts,
          rateLimiters = services.rateLimiters,
          idempotency = repositories.idempotency,
          healthDetails = services.healthDetails,
          nowF = now,
        ))
        ApiApp.WiredRuntime(
          runtime = ApiApp.Runtime(
            app = app,
            backgroundFailure = Async[F].never[Nothing],
          ),
          handles = ApiApp.RuntimeHandles(
            gameTitles = repositories.gameTitles,
            mapMasters = repositories.mapMasters,
            seasonMasters = repositories.seasonMasters,
            loginAccounts = repositories.loginAccounts,
            createSession = authServices.sessionService.create,
            registeredEndpoints = registeredEndpoints,
          ),
        )
      }
