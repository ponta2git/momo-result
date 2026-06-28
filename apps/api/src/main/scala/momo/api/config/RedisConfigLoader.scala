package momo.api.config

import cats.MonadThrow
import cats.syntax.all.*

private[config] object RedisConfigLoader:
  def load[F[_]: MonadThrow](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[Option[RedisConfig]] =
    val urlOpt = env.get("REDIS_URL").filter(_.nonEmpty)
    val allowPlaintextInProd =
      ConfigParsers.parseBoolean(env, "REDIS_ALLOW_PLAINTEXT_IN_PROD", default = false)
    urlOpt match
      case None if appEnv == AppEnv.Prod =>
        MonadThrow[F]
          .raiseError(new IllegalArgumentException("REDIS_URL is required in prod APP_ENV"))
      case None => MonadThrow[F].pure(None)
      case Some(url) =>
        for
          allowPlaintext <- allowPlaintextInProd.liftTo[F]
          safeUrl <- RedisUrlConfig.ensureProdRedisUrl(url, appEnv, allowPlaintext).liftTo[F]
        yield Some(RedisConfig(
          url = safeUrl,
          stream = ConfigParsers.envOrDefault(env, "OCR_REDIS_STREAM", "momo:ocr:jobs"),
          group = ConfigParsers.envOrDefault(env, "OCR_REDIS_GROUP", "momo-ocr-workers"),
          deadLetterStream =
            ConfigParsers.envOrDefault(
              env,
              "OCR_REDIS_DEAD_LETTER_STREAM",
              RedisConfig.DefaultDeadLetterStream
            ),
        ))
