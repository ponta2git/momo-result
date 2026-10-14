package momo.api.bootstrap

import scala.concurrent.duration.*

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*

import momo.api.adapters.redis.{
  RedisOAuthProviderBackoff,
  RedisOAuthStateReplayGuard,
  RedisRateLimiter
}
import momo.api.auth.{
  InMemoryOAuthProviderBackoff,
  InMemoryOAuthStateReplayGuard,
  LoginRateLimiter,
  OAuthProviderBackoff,
  OAuthStateReplayGuard,
  RateLimiter,
  ResilientRateLimiter
}
import momo.api.config.AppConfig
import momo.api.http.HttpRateLimiters

private[bootstrap] final case class RuntimeInfrastructure[F[_]](
    redisHealth: F[Unit],
    loginRateLimiter: RateLimiter[F],
    oauthStateReplayGuard: OAuthStateReplayGuard[F],
    oauthProviderBackoff: OAuthProviderBackoff[F],
    rateLimiters: HttpRateLimiters[F],
)

private[bootstrap] object RuntimeInfrastructure:
  private val CoreRateLimiterFallbackAfter = 250.millis

  def resource[F[_]: Async](
      config: AppConfig,
      now: F[java.time.Instant],
  ): Resource[F, RuntimeInfrastructure[F]] = config.redis match
    case Some(redis) => Redis[F].simple(redis.url, RedisCodec.Utf8).evalMap { commands =>
        val login: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "login", config.auth.rateLimitPerMinute, now)
        val stateReplayGuard = RedisOAuthStateReplayGuard(commands, now)
        val oauthProviderBackoff: OAuthProviderBackoff[F] = RedisOAuthProviderBackoff.fromCommands(
          commands,
          "discord",
          config.auth.providerFailureThreshold,
          config.auth.providerBackoff,
          now,
        )
        val upload: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "upload", config.resourceLimits.uploadRateLimitPerMinute, now)
        val exportLimiter: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "export", config.resourceLimits.exportRateLimitPerMinute, now)
        val exportAllLimiter: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "export-all",
          config.resourceLimits.exportAllRateLimitPerMinute,
          now,
        )
        val sourceImageDownload: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "source-image-download",
          config.resourceLimits.sourceImageDownloadRateLimitPerMinute,
          now,
        )
        val readApiPrimary: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "read-api", config.resourceLimits.readApiRateLimitPerMinute, now)
        val mutationPrimary: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "mutation", config.resourceLimits.mutationRateLimitPerMinute, now)
        val ocrJobCreate: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "ocr-job-create",
          config.resourceLimits.ocrJobCreateRateLimitPerMinute,
          now,
        )
        val ocrJobCreateGlobal: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "ocr-job-create-global",
          config.resourceLimits.ocrJobCreateGlobalRateLimitPerMinute,
          now,
        )
        for
          readApiFallback <- LoginRateLimiter
            .create[F](config.resourceLimits.readApiRateLimitPerMinute, now)
          mutationFallback <- LoginRateLimiter
            .create[F](config.resourceLimits.mutationRateLimitPerMinute, now)
          readApi <- ResilientRateLimiter.create[F](
            readApiPrimary,
            readApiFallback,
            CoreRateLimiterFallbackAfter,
            "read-api",
          )
          mutation <- ResilientRateLimiter.create[F](
            mutationPrimary,
            mutationFallback,
            CoreRateLimiterFallbackAfter,
            "mutation",
          )
        yield RuntimeInfrastructure(
          commands.ping.void,
          login,
          stateReplayGuard,
          oauthProviderBackoff,
          HttpRateLimiters(
            upload,
            exportLimiter,
            exportAllLimiter,
            sourceImageDownload,
            readApi,
            mutation,
            ocrJobCreate,
            ocrJobCreateGlobal,
          ),
        )
      }
    case None => Resource.eval(
        for
          login <- LoginRateLimiter.create[F](config.auth.rateLimitPerMinute, now)
          stateReplayGuard <- InMemoryOAuthStateReplayGuard.create[F](now)
          oauthProviderBackoff <- InMemoryOAuthProviderBackoff
            .create[F](config.auth.providerFailureThreshold, config.auth.providerBackoff, now)
          upload <- LoginRateLimiter.create[F](config.resourceLimits.uploadRateLimitPerMinute, now)
          exportLimiter <- LoginRateLimiter
            .create[F](config.resourceLimits.exportRateLimitPerMinute, now)
          exportAllLimiter <- LoginRateLimiter
            .create[F](config.resourceLimits.exportAllRateLimitPerMinute, now)
          sourceImageDownload <- LoginRateLimiter
            .create[F](config.resourceLimits.sourceImageDownloadRateLimitPerMinute, now)
          readApi <- LoginRateLimiter
            .create[F](config.resourceLimits.readApiRateLimitPerMinute, now)
          mutation <- LoginRateLimiter
            .create[F](config.resourceLimits.mutationRateLimitPerMinute, now)
          ocrJobCreate <- LoginRateLimiter
            .create[F](config.resourceLimits.ocrJobCreateRateLimitPerMinute, now)
          ocrJobCreateGlobal <- LoginRateLimiter
            .create[F](config.resourceLimits.ocrJobCreateGlobalRateLimitPerMinute, now)
        yield RuntimeInfrastructure(
          Async[F].unit,
          login,
          stateReplayGuard,
          oauthProviderBackoff,
          HttpRateLimiters(
            upload,
            exportLimiter,
            exportAllLimiter,
            sourceImageDownload,
            readApi,
            mutation,
            ocrJobCreate,
            ocrJobCreateGlobal,
          ),
        )
      )
