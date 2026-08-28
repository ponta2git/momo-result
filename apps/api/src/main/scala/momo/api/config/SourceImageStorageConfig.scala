package momo.api.config

import java.net.URI
import java.time.Duration

import scala.concurrent.duration.*
import scala.util.Try

import cats.effect.Async
import cats.syntax.all.*

enum SourceImageStorageConfig derives CanEqual:
  case Local
  case R2(config: R2SourceImageStorageConfig)

final class SourceImageR2Credentials private[config] (
    private[momo] val accessKeyId: String,
    private[momo] val secretAccessKey: String,
):
  override def toString: String = "SourceImageR2Credentials([REDACTED])"

final case class R2SourceImageStorageConfig(
    endpoint: URI,
    region: String,
    bucket: String,
    credentials: SourceImageR2Credentials,
    operationTimeout: Duration,
    attemptTimeout: Duration,
    maximumAttempts: Int,
    staleStateAge: FiniteDuration,
    failedRecordRetention: FiniteDuration,
    reconciliationBatchSize: Int,
):
  override def toString: String =
    s"R2SourceImageStorageConfig(endpoint=[REDACTED], region=$region, bucket=[REDACTED], " +
      s"credentials=[REDACTED], operationTimeout=$operationTimeout, " +
      s"attemptTimeout=$attemptTimeout, maximumAttempts=$maximumAttempts, " +
      s"staleStateAge=$staleStateAge, failedRecordRetention=$failedRecordRetention, " +
      s"reconciliationBatchSize=$reconciliationBatchSize)"

private[config] object SourceImageStorageConfigLoader:
  private val ModeEnv = "SOURCE_IMAGE_STORAGE_MODE"

  def load[F[_]: Async](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[SourceImageStorageConfig] = mode(env, appEnv).flatMap {
    case "local" => Async[F].pure(SourceImageStorageConfig.Local)
    case "r2" => r2(env).liftTo[F].map(SourceImageStorageConfig.R2.apply)
    case _ => Async[F].raiseError(
        new IllegalArgumentException(s"$ModeEnv must be local or r2.")
      )
  }

  private def mode[F[_]: Async](env: Map[String, String], appEnv: AppEnv): F[String] =
    env.get(ModeEnv).map(_.trim.toLowerCase).filter(_.nonEmpty) match
      case Some(value) => Async[F].pure(value)
      case None if appEnv == AppEnv.Prod =>
        Async[F].raiseError(
          new IllegalArgumentException(s"$ModeEnv must be explicitly set in prod APP_ENV.")
        )
      case None => Async[F].pure("local")

  private def r2(env: Map[String, String]): Either[Throwable, R2SourceImageStorageConfig] =
    for
      endpointRaw <- required(env, "SOURCE_IMAGE_R2_ENDPOINT")
      endpoint <- Try(URI.create(endpointRaw)).toEither.leftMap(_ => invalidR2)
      bucket <- required(env, "SOURCE_IMAGE_R2_BUCKET")
      accessKeyId <- required(env, "SOURCE_IMAGE_R2_ACCESS_KEY_ID")
      secretAccessKey <- required(env, "SOURCE_IMAGE_R2_SECRET_ACCESS_KEY")
      region = value(env, "SOURCE_IMAGE_R2_REGION").getOrElse("auto")
      operationTimeoutMs <- positiveLong(env, "SOURCE_IMAGE_R2_OPERATION_TIMEOUT_MS", 10000L)
      attemptTimeoutMs <- positiveLong(env, "SOURCE_IMAGE_R2_ATTEMPT_TIMEOUT_MS", 5000L)
      maximumAttempts <- positiveInt(env, "SOURCE_IMAGE_R2_MAXIMUM_ATTEMPTS", 2)
      staleStateSeconds <- positiveLong(
        env,
        "SOURCE_IMAGE_RECONCILIATION_STALE_SECONDS",
        60L,
      )
      failedRetentionMinutes <- positiveLong(
        env,
        "SOURCE_IMAGE_FAILED_RETENTION_MINUTES",
        60L,
      )
      batchSize <- positiveInt(env, "SOURCE_IMAGE_RECONCILIATION_BATCH_SIZE", 100)
      _ <- Either.cond(
        attemptTimeoutMs <= operationTimeoutMs && maximumAttempts <= 2 && batchSize <= 1000,
        (),
        invalidR2,
      )
    yield R2SourceImageStorageConfig(
      endpoint = endpoint,
      region = region,
      bucket = bucket,
      credentials = SourceImageR2Credentials(accessKeyId, secretAccessKey),
      operationTimeout = Duration.ofMillis(operationTimeoutMs),
      attemptTimeout = Duration.ofMillis(attemptTimeoutMs),
      maximumAttempts = maximumAttempts,
      staleStateAge = staleStateSeconds.seconds,
      failedRecordRetention = failedRetentionMinutes.minutes,
      reconciliationBatchSize = batchSize,
    )

  private def required(env: Map[String, String], name: String): Either[Throwable, String] =
    value(env, name).toRight(new IllegalArgumentException(s"$name is required in r2 mode."))

  private def value(env: Map[String, String], name: String): Option[String] = env.get(name)
    .map(_.trim).filter(_.nonEmpty)

  private def positiveLong(
      env: Map[String, String],
      name: String,
      default: Long,
  ): Either[Throwable, Long] = value(env, name).fold(Right(default)) { raw =>
    raw.toLongOption.filter(_ > 0L).toRight(
      new IllegalArgumentException(s"$name must be a positive integer.")
    )
  }

  private def positiveInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = value(env, name).fold(Right(default)) { raw =>
    raw.toIntOption.filter(_ > 0).toRight(
      new IllegalArgumentException(s"$name must be a positive integer.")
    )
  }

  private val invalidR2: IllegalArgumentException = new IllegalArgumentException(
    "R2 source image storage configuration is invalid."
  )
