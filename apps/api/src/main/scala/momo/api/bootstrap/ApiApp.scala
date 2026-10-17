package momo.api.bootstrap

import cats.effect.std.SecureRandom
import cats.effect.{Async, Resource}
import org.http4s.HttpApp as Http4sApp
import sttp.tapir.AnyEndpoint

import momo.api.adapters.discord.JavaDiscordOAuthClient
import momo.api.auth.CreatedSession
import momo.api.config.{AppConfig, MaintenanceMode, ResourceLimitsConfig}
import momo.api.domain.LoginAccount
import momo.api.usecases.ocr.OcrAdmissionGuard

object ApiApp:
  final case class Runtime[F[_]](
      app: Http4sApp[F],
      /** Fails when a supervised background runtime boundary can no longer make safe progress. */
      backgroundFailure: F[Nothing],
  )

  /** Package-local handles for seeding and inspecting a fully wired runtime in contract tests. */
  private[api] final case class RuntimeHandles[F[_]](
      gameTitles: momo.api.repositories.GameTitlesRepository[F],
      mapMasters: momo.api.repositories.MapMastersRepository[F],
      seasonMasters: momo.api.repositories.SeasonMastersRepository[F],
      loginAccounts: momo.api.repositories.LoginAccountsRepository[F],
      createSession: LoginAccount => F[CreatedSession],
      /** Compiled Tapir contracts registered in `app`; exposed inside the API for contract checks. */
      registeredEndpoints: List[AnyEndpoint],
  )

  private[api] final case class WiredRuntime[F[_]](
      runtime: Runtime[F],
      handles: RuntimeHandles[F],
  )

  def resource[F[_]: Async](config: AppConfig): Resource[F, Http4sApp[F]] = wired[F](config)
    .map(_.app)

  /** Build the application against its PostgreSQL persistence boundary. */
  def wired[F[_]: Async](config: AppConfig): Resource[F, Runtime[F]] = config.maintenanceMode match
    case MaintenanceMode.Normal => wiredWithHandles(config).map(_.runtime)
    case MaintenanceMode.Frozen => FrozenApiRuntime.resource(config)

  private[api] def wiredWithHandles[F[_]: Async](
      config: AppConfig
  ): Resource[F, WiredRuntime[F]] =
    if config.maintenanceMode != MaintenanceMode.Normal then
      Resource.eval(Async[F].raiseError(new IllegalArgumentException(
        "Normal runtime handles are unavailable during maintenance."
      )))
    else normalRuntime(config)

  private def normalRuntime[F[_]: Async](config: AppConfig): Resource[F, WiredRuntime[F]] = Resource
    .eval(SecureRandom.javaSecuritySecureRandom[F]).flatMap { case given SecureRandom[F] =>
      JavaDiscordOAuthClient.resource[F](JavaDiscordOAuthClient.Config(
        clientId = config.auth.discordClientId.getOrElse(""),
        clientSecret = config.auth.discordClientSecret.getOrElse(""),
        redirectUri = config.auth.discordRedirectUri.getOrElse(""),
        scope = config.auth.discordScope,
      ))
        .flatMap { oauthClient =>
          config.database match
            case Some(db) => PostgresApiRuntime.resource[F](config, db, oauthClient)
            case None => Resource.eval(Async[F].raiseError[WiredRuntime[F]](
                new IllegalArgumentException("API runtime requires a database configuration.")
              ))
        }
    }

  private[bootstrap] def ocrAdmissionGuardConfig(
      limits: ResourceLimitsConfig
  ): OcrAdmissionGuard.Config =
    OcrAdmissionGuard.Config(
      activeJobLimit = limits.ocrActiveJobLimit,
      oldestReadyMaxDelay = limits.ocrJobOldestReadyMaxDelay,
    )
