package momo.api.bootstrap

import cats.effect.std.SecureRandom
import cats.effect.{Async, Resource}
import org.http4s.HttpApp as Http4sApp
import sttp.tapir.AnyEndpoint

import momo.api.auth.{CreatedSession, DiscordOAuthClient, JavaDiscordOAuthClient}
import momo.api.config.{AppConfig, ResourceLimitsConfig}
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

  /**
   * Build all dependencies. When `config.database` is set we use PostgreSQL repositories backed by
   * HikariCP; otherwise we wire up InMemory adapters (used by tests and the early dev environment).
   */
  def wired[F[_]: Async](config: AppConfig): Resource[F, Runtime[F]] = wiredWithHandles(config)
    .map(_.runtime)

  private[api] def wiredWithHandles[F[_]: Async](
      config: AppConfig
  ): Resource[F, WiredRuntime[F]] = Resource
    .eval(SecureRandom.javaSecuritySecureRandom[F]).flatMap { case given SecureRandom[F] =>
      JavaDiscordOAuthClient.resource[F](config.auth)
        .flatMap(oauthClient => wiredInner[F](config, oauthClient))
    }

  private def wiredInner[F[_]: Async: SecureRandom](
      config: AppConfig,
      oauthClient: DiscordOAuthClient[F],
  ): Resource[F, WiredRuntime[F]] = config.database match
    case Some(db) => PostgresApiRuntime.resource[F](config, db, oauthClient)
    case None => InMemoryApiRuntime.resource[F](config, oauthClient)

  private[bootstrap] def ocrAdmissionGuardConfig(
      limits: ResourceLimitsConfig
  ): OcrAdmissionGuard.Config =
    OcrAdmissionGuard.Config(
      dueBacklogLimit = limits.ocrOutboxDueBacklogLimit,
      activeBacklogLimit = limits.ocrOutboxActiveBacklogLimit,
      oldestDueMaxDelay = limits.ocrOutboxOldestDueMaxDelay,
      deadLetterBacklogLimit = limits.ocrDeadLetterBacklogLimit,
    )
