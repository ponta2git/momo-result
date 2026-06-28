package momo.api.config

import java.net.URI

import cats.syntax.all.*

private[config] object RedisUrlConfig:
  private[config] def ensureProdRedisUrl(raw: String, appEnv: AppEnv): Either[Throwable, String] =
    ensureProdRedisUrl(raw, appEnv, allowPlaintextInProd = false)

  private[config] def ensureProdRedisUrl(
      raw: String,
      appEnv: AppEnv,
      allowPlaintextInProd: Boolean,
  ): Either[Throwable, String] =
    if appEnv != AppEnv.Prod then Right(raw)
    else
      Either.catchNonFatal(URI.create(raw))
        .leftMap(_ => new IllegalArgumentException("REDIS_URL must be a valid Redis URL."))
        .flatMap { uri =>
          val scheme = Option(uri.getScheme).map(_.toLowerCase)
          val hasValidScheme = scheme.contains("rediss") ||
            (allowPlaintextInProd && scheme.contains("redis"))
          val invalidSchemeMessage =
            if allowPlaintextInProd then
              "REDIS_URL must use rediss://, or redis:// when REDIS_ALLOW_PLAINTEXT_IN_PROD=true."
            else "REDIS_URL must use rediss:// in prod APP_ENV."

          Either.cond(hasValidScheme, (), new IllegalArgumentException(invalidSchemeMessage))
            .flatMap(_ =>
              Option(uri.getHost).filter(_.trim.nonEmpty)
                .toRight(new IllegalArgumentException("REDIS_URL must include a Redis host."))
            ).as(raw)
        }
