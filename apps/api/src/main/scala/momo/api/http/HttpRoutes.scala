package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import org.http4s.server.Router
import org.http4s.{HttpApp as Http4sApp, HttpRoutes as Http4sRoutes}
import sttp.tapir.server.ServerEndpoint
import sttp.tapir.server.http4s.Http4sServerInterpreter

import momo.api.auth.{
  CsrfTokenService, DiscordOAuthClient, LoginRateLimiter, MemberRoster, OAuthStateCodec,
  SessionService,
}
import momo.api.config.AppConfig
import momo.api.http.modules.{
  AdminAccountModule, ExportModule, HealthModule, HeldEventModule, MasterModule, MatchDraftModule,
  MatchModule, OcrModule, UploadModule,
}
import momo.api.repositories.{
  GameTitlesRepository, IdempotencyRepository, IncidentMastersRepository, LoginAccountsRepository,
  MapMastersRepository, MembersRepository, SeasonMastersRepository,
}
import momo.api.usecases.*

object HttpRoutes:
  final case class Dependencies[F[_]](
      config: AppConfig,
      roster: MemberRoster,
      uploadImage: UploadImage[F],
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      cancelOcrJob: CancelOcrJob[F],
      listHeldEvents: ListHeldEvents[F],
      createHeldEvent: CreateHeldEvent[F],
      createMatchDraft: CreateMatchDraft[F],
      getMatchDraft: GetMatchDraft[F],
      updateMatchDraft: UpdateMatchDraft[F],
      cancelMatchDraft: CancelMatchDraft[F],
      getMatchDraftSourceImages: GetMatchDraftSourceImages[F],
      confirmMatch: ConfirmMatch[F],
      exportMatches: ExportMatches[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      deleteMatch: DeleteMatch[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
      loginAccounts: LoginAccountsRepository[F],
      listLoginAccounts: ListLoginAccounts[F],
      createLoginAccount: CreateLoginAccount[F],
      updateLoginAccount: UpdateLoginAccount[F],
      createGameTitle: CreateGameTitle[F],
      createMapMaster: CreateMapMaster[F],
      createSeasonMaster: CreateSeasonMaster[F],
      members: MembersRepository[F],
      oauthClient: DiscordOAuthClient[F],
      sessionService: SessionService[F],
      csrfTokenService: CsrfTokenService,
      oauthStateCodec: OAuthStateCodec[F],
      loginRateLimiter: LoginRateLimiter[F],
      rateLimiters: HttpRateLimiters[F],
      idempotency: IdempotencyRepository[F],
      healthDetails: F[momo.api.endpoints.HealthEndpoints.HealthDetailsResponse],
      nowF: F[java.time.Instant],
  )

  def routes[F[_]: Async](deps: Dependencies[F]): Http4sApp[F] =
    val security = EndpointSecurity[F](AuthPolicy[F](deps.config, deps.roster, deps.loginAccounts))

    val endpoints: List[ServerEndpoint[Any, F]] = HealthModule.routes[F](deps.healthDetails) :::
      UploadModule.routes[F](deps.uploadImage, deps.rateLimiters.upload, security) :::
      OcrModule.routes[F](
        deps.createOcrJob,
        deps.getOcrJob,
        deps.cancelOcrJob,
        deps.getOcrDraft,
        deps.getOcrDraftsBulk,
        deps.idempotency,
        deps.nowF,
        security,
      ) ::: HeldEventModule.routes[F](
        deps.listHeldEvents,
        deps.createHeldEvent,
        deps.idempotency,
        deps.nowF,
        security,
      ) ::: MatchDraftModule.routes[F](
        deps.createMatchDraft,
        deps.getMatchDraft,
        deps.updateMatchDraft,
        deps.cancelMatchDraft,
        deps.getMatchDraftSourceImages,
        deps.idempotency,
        deps.nowF,
        security,
      ) ::: ExportModule.routes[F](deps.exportMatches, deps.rateLimiters.matchExport, security) :::
      MatchModule.routes[F](
        deps.confirmMatch,
        deps.listMatches,
        deps.getMatch,
        deps.updateMatch,
        deps.deleteMatch,
        deps.idempotency,
        deps.nowF,
        security,
      ) ::: MasterModule.routes[F](
        deps.gameTitles,
        deps.mapMasters,
        deps.seasonMasters,
        deps.incidentMasters,
        deps.createGameTitle,
        deps.createMapMaster,
        deps.createSeasonMaster,
        deps.idempotency,
        deps.nowF,
        security,
      ) ::: AdminAccountModule.routes[F](
        deps.listLoginAccounts,
        deps.createLoginAccount,
        deps.updateLoginAccount,
        deps.idempotency,
        deps.nowF,
        security,
      )

    val tapirRoutes = Http4sServerInterpreter[F]().toRoutes(endpoints)

    val protectedRoutes =
      ProductionSessionMiddleware[F](deps.config, deps.sessionService, deps.csrfTokenService)(
        tapirRoutes.orNotFound
      )

    val authRoutes = AuthHttpRoutes.routes[F](
      config = deps.config,
      oauth = deps.oauthClient,
      stateCodec = deps.oauthStateCodec,
      sessions = deps.sessionService,
      csrf = deps.csrfTokenService,
      accounts = deps.loginAccounts,
      rateLimiter = deps.loginRateLimiter,
    )

    RequestIdMiddleware[F](SecurityHeadersMiddleware[F](deps.config.appEnv)(HttpErrorMiddleware[F](
      MaxBodySizeMiddleware.uploadOnly[F](deps.config.resourceLimits.uploadRequestMaxBytes)(
        Router("/" -> (authRoutes <+> Http4sRoutes.of[F](request => protectedRoutes.run(request))))
          .orNotFound
      )
    )))
end HttpRoutes
