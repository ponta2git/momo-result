package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import org.http4s.server.Router
import org.http4s.{HttpApp as Http4sApp, HttpRoutes as Http4sRoutes}
import sttp.tapir.server.ServerEndpoint
import sttp.tapir.server.http4s.Http4sServerInterpreter

import momo.api.auth.{
  CsrfTokenService,
  DiscordOAuthClient,
  MemberRoster,
  OAuthProviderBackoff,
  OAuthStateCodec,
  RateLimiter,
  SessionService
}
import momo.api.config.AppConfig
import momo.api.http.modules.{
  AdminAccountModule,
  AnalyticsModule,
  AuthModule,
  ExportModule,
  HealthModule,
  HeldEventModule,
  MasterModule,
  MatchDraftModule,
  MatchModule,
  OcrModule,
  UploadModule
}
import momo.api.repositories.{IdempotencyRepository, LoginAccountsRepository}
import momo.api.usecases.admin.*
import momo.api.usecases.exports.*
import momo.api.usecases.heldevents.*
import momo.api.usecases.images.*
import momo.api.usecases.matchdrafts.*
import momo.api.usecases.matches.*
import momo.api.usecases.masters.*
import momo.api.usecases.ocr.*
import momo.api.usecases.seriescomparison.*

object HttpRoutes:
  final case class AuthDependencies[F[_]](
      roster: MemberRoster,
      loginAccounts: LoginAccountsRepository[F],
      oauthClient: DiscordOAuthClient[F],
      sessionService: SessionService[F],
      csrfTokenService: CsrfTokenService,
      oauthStateCodec: OAuthStateCodec[F],
      loginRateLimiter: RateLimiter[F],
      authCallbackStateRateLimiter: RateLimiter[F],
      oauthProviderBackoff: OAuthProviderBackoff[F],
  )

  final case class UploadUseCases[F[_]](uploadImage: UploadImage[F])

  final case class OcrUseCases[F[_]](
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      cancelOcrJob: CancelOcrJob[F],
  )

  final case class HeldEventUseCases[F[_]](
      listHeldEvents: ListHeldEvents[F],
      createHeldEvent: CreateHeldEvent[F],
      deleteHeldEvent: DeleteHeldEvent[F],
  )

  final case class MatchDraftUseCases[F[_]](
      createMatchDraft: CreateMatchDraft[F],
      getMatchDraft: GetMatchDraft[F],
      updateMatchDraft: UpdateMatchDraft[F],
      cancelMatchDraft: CancelMatchDraft[F],
      getMatchDraftSourceImages: GetMatchDraftSourceImages[F],
  )

  final case class MatchUseCases[F[_]](
      confirmMatch: ConfirmMatch[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      deleteMatch: DeleteMatch[F],
  )

  final case class AnalyticsUseCases[F[_]](
      getSeriesComparisonOptions: GetSeriesComparisonOptions[F],
      getSeriesComparison: GetSeriesComparison[F],
      getSeriesComparisonReview: GetSeriesComparisonReview[F],
      getSeriesComparisonDrilldown: GetSeriesComparisonDrilldown[F],
  )

  final case class MasterUseCases[F[_]](
      listGameTitles: ListGameTitles[F],
      listMapMasters: ListMapMasters[F],
      listSeasonMasters: ListSeasonMasters[F],
      listIncidentMasters: ListIncidentMasters[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F],
      updateGameTitle: UpdateGameTitle[F],
      updateMapMaster: UpdateMapMaster[F],
      updateSeasonMaster: UpdateSeasonMaster[F],
      deleteGameTitle: DeleteGameTitle[F],
      deleteMapMaster: DeleteMapMaster[F],
      deleteSeasonMaster: DeleteSeasonMaster[F],
      listMemberAliases: ListMemberAliases[F],
      createMemberAlias: CreateMemberAlias[F],
      updateMemberAlias: UpdateMemberAlias[F],
      deleteMemberAlias: DeleteMemberAlias[F],
  )

  final case class AdminAccountUseCases[F[_]](
      listLoginAccounts: ListLoginAccounts[F],
      createLoginAccount: CreateLoginAccount[F],
      updateLoginAccount: UpdateLoginAccount[F],
  )

  final case class Dependencies[F[_]](
      config: AppConfig,
      auth: AuthDependencies[F],
      upload: UploadUseCases[F],
      ocr: OcrUseCases[F],
      heldEvents: HeldEventUseCases[F],
      matchDrafts: MatchDraftUseCases[F],
      matches: MatchUseCases[F],
      exportMatches: ExportMatches[F],
      analytics: AnalyticsUseCases[F],
      masters: MasterUseCases[F],
      adminAccounts: AdminAccountUseCases[F],
      rateLimiters: HttpRateLimiters[F],
      idempotency: IdempotencyRepository[F],
      healthDetails: F[momo.api.endpoints.HealthEndpoints.HealthDetailsResponse],
      nowF: F[java.time.Instant],
  )

  def routes[F[_]: Async](deps: Dependencies[F]): Http4sApp[F] =
    val security =
      EndpointSecurity[F](AuthPolicy[F](deps.config, deps.auth.roster, deps.auth.loginAccounts))
    val idempotencyGuard = IdempotencyReplay.Guard(
      repository = deps.idempotency,
      mutationRateLimiter = deps.rateLimiters.mutation,
      activeKeyLimitPerAccount = deps.config.resourceLimits.idempotencyActiveKeyLimitPerAccount,
    )

    val endpoints: List[ServerEndpoint[Any, F]] = HealthModule.routes[F](deps.healthDetails) :::
      UploadModule.routes[F](deps.upload.uploadImage, deps.rateLimiters.upload, security) :::
      OcrModule.routes[F](
        deps.ocr.createOcrJob,
        deps.ocr.getOcrJob,
        deps.ocr.cancelOcrJob,
        deps.ocr.getOcrDraft,
        deps.ocr.getOcrDraftsBulk,
        deps.rateLimiters.ocrJobCreate,
        deps.rateLimiters.ocrJobCreateGlobal,
        deps.rateLimiters.readApi,
        idempotencyGuard,
        deps.nowF,
        security,
      ) ::: HeldEventModule.routes[F](
        deps.heldEvents.listHeldEvents,
        deps.heldEvents.createHeldEvent,
        deps.heldEvents.deleteHeldEvent,
        idempotencyGuard,
        deps.nowF,
        security,
      ) ::: MatchDraftModule.routes[F](
        deps.matchDrafts.createMatchDraft,
        deps.matchDrafts.getMatchDraft,
        deps.matchDrafts.updateMatchDraft,
        deps.matchDrafts.cancelMatchDraft,
        deps.matchDrafts.getMatchDraftSourceImages,
        deps.rateLimiters.sourceImageDownload,
        idempotencyGuard,
        deps.nowF,
        security,
      ) ::: ExportModule.routes[F](
        deps.exportMatches,
        deps.rateLimiters.matchExport,
        deps.rateLimiters.matchExportAll,
        security,
      ) ::: MatchModule.routes[F](
        deps.matches.confirmMatch,
        deps.matches.listMatches,
        deps.matches.getMatch,
        deps.matches.updateMatch,
        deps.matches.deleteMatch,
        deps.rateLimiters.readApi,
        idempotencyGuard,
        deps.nowF,
        security,
      ) ::: AnalyticsModule.routes[F](
        deps.analytics.getSeriesComparisonOptions,
        deps.analytics.getSeriesComparison,
        deps.analytics.getSeriesComparisonReview,
        deps.analytics.getSeriesComparisonDrilldown,
        deps.rateLimiters.readApi,
        security,
      ) ::: MasterModule.routes[F](
        deps.masters.listGameTitles,
        deps.masters.listMapMasters,
        deps.masters.listSeasonMasters,
        deps.masters.listIncidentMasters,
        deps.masters.createGameTitle,
        deps.masters.createMapMaster,
        deps.masters.createSeasonMaster,
        deps.masters.updateGameTitle,
        deps.masters.updateMapMaster,
        deps.masters.updateSeasonMaster,
        deps.masters.deleteGameTitle,
        deps.masters.deleteMapMaster,
        deps.masters.deleteSeasonMaster,
        deps.masters.listMemberAliases,
        deps.masters.createMemberAlias,
        deps.masters.updateMemberAlias,
        deps.masters.deleteMemberAlias,
        idempotencyGuard,
        deps.nowF,
        security,
      ) ::: AdminAccountModule.routes[F](
        deps.adminAccounts.listLoginAccounts,
        deps.adminAccounts.createLoginAccount,
        deps.adminAccounts.updateLoginAccount,
        idempotencyGuard,
        deps.nowF,
        security,
      )

    val interpreter = Http4sServerInterpreter[F]()
    val tapirRoutes = interpreter.toRoutes(endpoints)

    val protectedRoutes =
      ProductionSessionMiddleware[F](
        deps.config,
        deps.auth.sessionService,
        deps.auth.csrfTokenService,
      )(
        tapirRoutes.orNotFound
      )

    val authRoutes = interpreter.toRoutes(AuthModule.routes[F](
      config = deps.config,
      oauth = deps.auth.oauthClient,
      stateCodec = deps.auth.oauthStateCodec,
      sessions = deps.auth.sessionService,
      csrf = deps.auth.csrfTokenService,
      accounts = deps.auth.loginAccounts,
      rateLimiter = deps.auth.loginRateLimiter,
      callbackStateRateLimiter = deps.auth.authCallbackStateRateLimiter,
      providerBackoff = deps.auth.oauthProviderBackoff,
    ))

    RequestIdMiddleware[F](SecurityHeadersMiddleware[F](deps.config.appEnv)(HttpErrorMiddleware[F](
      MaxBodySizeMiddleware.requestAndUpload[F](
        deps.config.resourceLimits.requestMaxBytes,
        deps.config.resourceLimits.uploadRequestMaxBytes,
      )(
        Router("/" -> (authRoutes <+> Http4sRoutes.of[F](request => protectedRoutes.run(request))))
          .orNotFound
      )
    )))
end HttpRoutes
