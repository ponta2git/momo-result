package momo.api.bootstrap

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import dev.profunktor.redis4cats.Redis
import dev.profunktor.redis4cats.data.RedisCodec
import dev.profunktor.redis4cats.effect.Log.NoOp.*

import momo.api.adapters.{InMemoryQueueProducer, RedisQueueProducer}
import momo.api.auth.{
  InMemoryOAuthProviderBackoff,
  LoginRateLimiter,
  OAuthProviderBackoff,
  RateLimiter,
  RedisOAuthProviderBackoff,
  RedisRateLimiter
}
import momo.api.config.AppConfig
import momo.api.http.HttpRateLimiters
import momo.api.repositories.{QueueHealthProbe, QueueProducer}

private[bootstrap] final case class RuntimeInfrastructure[F[_]](
    queue: QueueProducer[F],
    queueHealth: QueueHealthProbe[F],
    loginRateLimiter: RateLimiter[F],
    authCallbackStateRateLimiter: RateLimiter[F],
    oauthProviderBackoff: OAuthProviderBackoff[F],
    rateLimiters: HttpRateLimiters[F],
)

private[bootstrap] object RuntimeInfrastructure:
  def resource[F[_]: Async](
      config: AppConfig,
      now: F[java.time.Instant],
  ): Resource[F, RuntimeInfrastructure[F]] = config.redis match
    case Some(redis) => Redis[F].simple(redis.url, RedisCodec.Utf8).map { commands =>
        val queue: QueueProducer[F] = RedisQueueProducer.fromCommands(redis.stream, commands)
        val queueHealth: QueueHealthProbe[F] = RedisQueueProducer
          .healthProbeFromCommands(redis.deadLetterStream, commands)
        val login: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "login", config.auth.rateLimitPerMinute, now)
        val authCallbackState: RateLimiter[F] = RedisRateLimiter.fromCommands(
          commands,
          "auth-callback-state",
          config.auth.callbackStateRateLimitPerMinute,
          now,
        )
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
        val readApi: RateLimiter[F] = RedisRateLimiter
          .fromCommands(commands, "read-api", config.resourceLimits.readApiRateLimitPerMinute, now)
        val mutation: RateLimiter[F] = RedisRateLimiter
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
        RuntimeInfrastructure(
          queue,
          queueHealth,
          login,
          authCallbackState,
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
          queue <- InMemoryQueueProducer.create[F]
          queueHealth = QueueHealthProbe.healthy[F]
          login <- LoginRateLimiter.create[F](config.auth.rateLimitPerMinute, now)
          authCallbackState <- LoginRateLimiter
            .create[F](config.auth.callbackStateRateLimitPerMinute, now)
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
          queue,
          queueHealth,
          login,
          authCallbackState,
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
