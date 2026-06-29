package momo.api.config

import cats.effect.Async
import cats.syntax.all.*

private[config] object RedisConfigLoader:
  def load[F[_]: Async](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[Option[RedisConfig]] =
    val urlOpt = env.get("REDIS_URL").filter(_.nonEmpty)
    urlOpt match
      case None if appEnv == AppEnv.Prod =>
        Async[F]
          .raiseError(new IllegalArgumentException("REDIS_URL is required in prod APP_ENV"))
      case None => Async[F].pure(None)
      case Some(url) =>
        for
          allowPlaintext <- ConfigParsers
            .parseBoolean(env, "REDIS_ALLOW_PLAINTEXT_IN_PROD", default = false).load[F]
          safeUrl <- RedisUrlConfig.ensureProdRedisUrl(url, appEnv, allowPlaintext).liftTo[F]
          stream <- ConfigParsers.envOrDefault(env, "OCR_REDIS_STREAM", "momo:ocr:jobs").load[F]
          deadLetterStream <- ConfigParsers
            .envOrDefault(env, "OCR_REDIS_DEAD_LETTER_STREAM", RedisConfig.DefaultDeadLetterStream)
            .load[F]
        yield Some(RedisConfig(
          url = safeUrl,
          stream = stream,
          deadLetterStream = deadLetterStream,
        ))
