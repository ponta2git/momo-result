package momo.api.bootstrap

import cats.effect.{Async, Resource}
import cats.syntax.all.*

import momo.api.auth.{LoginRateLimiter, RateLimiter}
import momo.api.config.AppConfig
import momo.api.http.HttpRateLimiters

private[bootstrap] final case class RuntimeInfrastructure[F[_]](
    loginRateLimiter: RateLimiter[F],
    rateLimiters: HttpRateLimiters[F],
)

private[bootstrap] object RuntimeInfrastructure:
  def resource[F[_]: Async](
      config: AppConfig,
      now: F[java.time.Instant],
  ): Resource[F, RuntimeInfrastructure[F]] = Resource.eval(
    for
      login <- LoginRateLimiter.create[F](config.auth.rateLimitPerMinute, now)
      upload <- LoginRateLimiter.create[F](config.resourceLimits.uploadRateLimitPerMinute, now)
      exportLimiter <-
        LoginRateLimiter.create[F](config.resourceLimits.exportRateLimitPerMinute, now)
      exportAllLimiter <-
        LoginRateLimiter.create[F](config.resourceLimits.exportAllRateLimitPerMinute, now)
      sourceImageDownload <-
        LoginRateLimiter.create[F](config.resourceLimits.sourceImageDownloadRateLimitPerMinute, now)
      readApi <- LoginRateLimiter.create[F](config.resourceLimits.readApiRateLimitPerMinute, now)
      mutation <- LoginRateLimiter.create[F](config.resourceLimits.mutationRateLimitPerMinute, now)
      mutationAttempt <-
        LoginRateLimiter.create[F](config.resourceLimits.mutationAttemptRateLimitPerMinute, now)
      authSession <-
        LoginRateLimiter.create[F](config.resourceLimits.authSessionRateLimitPerMinute, now)
      ocrJobCreate <-
        LoginRateLimiter.create[F](config.resourceLimits.ocrJobCreateRateLimitPerMinute, now)
      ocrJobCreateGlobal <-
        LoginRateLimiter.create[F](config.resourceLimits.ocrJobCreateGlobalRateLimitPerMinute, now)
    yield RuntimeInfrastructure(
      login,
      HttpRateLimiters(
        upload = upload,
        matchExport = exportLimiter,
        matchExportAll = exportAllLimiter,
        sourceImageDownload = sourceImageDownload,
        readApi = readApi,
        mutation = mutation,
        ocrJobCreate = ocrJobCreate,
        ocrJobCreateGlobal = ocrJobCreateGlobal,
        mutationAttempt = mutationAttempt,
        authSession = authSession,
      ),
    )
  )
