package momo.api.http

import cats.effect.Async
import cats.syntax.all.*
import org.http4s.HttpApp as Http4sApp
import org.http4s.server.Router
import sttp.model.StatusCode
import sttp.tapir.server.ServerEndpoint
import sttp.tapir.server.http4s.{Http4sServerInterpreter, Http4sServerOptions}
import sttp.tapir.server.interceptor.reject.RejectHandler
import sttp.tapir.server.model.ValuedEndpointOutput
import sttp.tapir.{header, statusCode, stringBody, AnyEndpoint, EndpointInput}

import momo.api.auth.{
  AccountAccess,
  CompleteOAuthCallback,
  CsrfTokenService,
  DiscordOAuthClient,
  MemberRoster,
  OAuthStateCodec,
  RateLimiter,
  SessionService
}
import momo.api.config.AppConfig
import momo.api.http.modules.{
  AchievementsModule,
  AdminAccountModule,
  AuthModule,
  ExportModule,
  HealthModule,
  HeldEventModule,
  MasterModule,
  MatchDraftModule,
  MatchModule,
  NotificationSettingsModule,
  OcrModule,
  SeriesAnalysisModule,
  SeriesPlayerRadarModule,
  UploadModule
}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.exports.ExportMatches

object HttpRoutes:
  /** Let the outer middleware own safe error logging and Problem Details for failed effects. */
  private[http] def serverOptions[F[_]: Async]: Http4sServerOptions[F] =
    Http4sServerOptions.customiseInterceptors[F]
      .exceptionHandler(None)
      .serverLog(None)
      .rejectHandler(RejectHandler.pure[F] { context =>
        val allowed = context.failure.failures.map(_.failingInput).collect {
          case method: EndpointInput.FixedMethod[?] => method.m.method
        }.distinct.sorted
        // RFC 9110 section 15.5.6 requires the target's methods on every 405 response.
        Option.when(allowed.nonEmpty)(ValuedEndpointOutput(
          statusCode(StatusCode.MethodNotAllowed).and(header[String]("Allow")).and(stringBody),
          (allowed.mkString(", "), "Method Not Allowed"),
        ))
      })
      .options

  final case class AuthDependencies[F[_]](
      roster: MemberRoster,
      accountAccess: AccountAccess[F],
      oauthClient: DiscordOAuthClient[F],
      sessionService: SessionService[F],
      csrfTokenService: CsrfTokenService,
      oauthStateCodec: OAuthStateCodec[F],
      loginRateLimiter: RateLimiter[F],
      completeOAuthCallback: CompleteOAuthCallback[F],
  )

  final case class UseCases[F[_]](
      upload: UploadModule.UseCases[F],
      ocr: OcrModule.UseCases[F],
      heldEvents: HeldEventModule.UseCases[F],
      matchDrafts: MatchDraftModule.UseCases[F],
      matches: MatchModule.UseCases[F],
      exportMatches: ExportMatches[F],
      seriesAnalysis: SeriesAnalysisModule.UseCases[F],
      achievements: momo.api.usecases.achievements.ManageAchievements[F],
      seriesPlayerRadar: SeriesPlayerRadarModule.UseCases[F],
      masters: MasterModule.UseCases[F],
      adminAccounts: AdminAccountModule.UseCases[F],
      notificationSettings: NotificationSettingsModule.UseCases[F],
  )

  final case class Dependencies[F[_]](
      config: AppConfig,
      auth: AuthDependencies[F],
      useCases: UseCases[F],
      rateLimiters: HttpRateLimiters[F],
      bodyAdmission: RequestBodyAdmission[F],
      idempotency: IdempotencyRepository[F],
      healthDetails: F[momo.api.endpoints.HealthEndpoints.HealthDetailsResponse],
      nowF: F[java.time.Instant],
  )

  def routes[F[_]: Async](deps: Dependencies[F]): Http4sApp[F] =
    routesWithEndpoints(deps)._1

  private[api] def routesWithEndpoints[F[_]: Async](
      deps: Dependencies[F]
  ): (Http4sApp[F], List[AnyEndpoint]) =
    val security =
      EndpointSecurity[F](AuthPolicy[F](
        deps.config,
        deps.auth.roster,
        deps.auth.accountAccess,
        deps.auth.sessionService,
        deps.auth.csrfTokenService,
        deps.rateLimiters.readApi,
        deps.rateLimiters.mutationAttempt,
      ))
    val idempotencyGuard = IdempotencyReplay.Guard(
      repository = deps.idempotency,
      mutationRateLimiter = deps.rateLimiters.mutation,
      activeKeyLimitPerAccount = deps.config.resourceLimits.idempotencyActiveKeyLimitPerAccount,
    )

    val context =
      HttpRouteContext(security, new EndpointExecution(security, idempotencyGuard, deps.nowF))
    val useCases = deps.useCases
    val endpoints: List[ServerEndpoint[Any, F]] = HealthModule
      .routes[F](deps.config, deps.healthDetails, security) :::
      UploadModule.routes(useCases.upload, deps.rateLimiters.upload, context) :::
      OcrModule.routes(
        useCases.ocr,
        deps.rateLimiters.ocrJobCreate,
        deps.rateLimiters.ocrJobCreateGlobal,
        context,
      ) :::
      HeldEventModule.routes(useCases.heldEvents, context) :::
      MatchDraftModule.routes(useCases.matchDrafts, context) :::
      ExportModule.routes(
        useCases.exportMatches,
        deps.rateLimiters.matchExport,
        deps.rateLimiters.matchExportAll,
        security,
      ) :::
      MatchModule.routes(useCases.matches, context) :::
      SeriesAnalysisModule.routes(useCases.seriesAnalysis, context) :::
      AchievementsModule.routes(useCases.achievements, context) :::
      SeriesPlayerRadarModule.routes(useCases.seriesPlayerRadar, context) :::
      MasterModule.routes(useCases.masters, context) :::
      AdminAccountModule.routes(useCases.adminAccounts, context) :::
      NotificationSettingsModule.routes(useCases.notificationSettings, context)
    val sourceImageEndpoints = MatchDraftModule.sourceImageRoutes[F](
      useCases.matchDrafts.getMatchDraftSourceImages,
      deps.rateLimiters.sourceImageDownload,
      security,
    )

    val interpreter = Http4sServerInterpreter[F](serverOptions[F])
    val tapirRoutes = interpreter.toRoutes(endpoints)
    val sourceImageRoutes = interpreter.toRoutes(sourceImageEndpoints)

    val authEndpoints = AuthModule.routes[F](
      config = deps.config,
      oauth = deps.auth.oauthClient,
      stateCodec = deps.auth.oauthStateCodec,
      sessions = deps.auth.sessionService,
      csrf = deps.auth.csrfTokenService,
      accounts = deps.auth.accountAccess,
      rateLimiter = deps.auth.loginRateLimiter,
      authSessionRateLimiter = deps.rateLimiters.authSession,
      completeOAuthCallback = deps.auth.completeOAuthCallback,
    )
    val authRoutes = interpreter.toRoutes(authEndpoints)

    val app =
      RequestIdMiddleware[F](HeadResponseMiddleware[F](
        SecurityHeadersMiddleware[F](deps.config.appEnv)(
          RequestDurationLoggingMiddleware[F](
            HttpErrorMiddleware[F](
              MaxBodySizeMiddleware.requestAndUpload[F](
                deps.config.resourceLimits.requestMaxBytes,
                deps.config.resourceLimits.uploadRequestMaxBytes,
              )(Router("/" -> (authRoutes <+> tapirRoutes <+> sourceImageRoutes)).orNotFound)
            ),
            deps.bodyAdmission.apply
          )
        )
      ))
    val registeredEndpoints =
      endpoints.map(_.endpoint) ::: sourceImageEndpoints.map(_.endpoint) ::: authEndpoints.map(
        _.endpoint
      )
    (app, registeredEndpoints)
end HttpRoutes
