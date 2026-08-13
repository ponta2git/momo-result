package momo.api.adapters.storage.r2

import java.net.URI
import java.time.Duration

final class R2Credentials private (
    private[r2] val accessKeyId: String,
    private[r2] val secretAccessKey: String,
):
  override def toString: String = "R2Credentials([REDACTED])"

object R2Credentials:
  def fromStrings(accessKeyId: String, secretAccessKey: String): Either[String, R2Credentials] =
    Either.cond(
      accessKeyId.nonEmpty && secretAccessKey.nonEmpty,
      R2Credentials(accessKeyId, secretAccessKey),
      "R2 access key ID and secret access key are required.",
    )

final case class R2SourceImageObjectStorageConfig private (
    endpoint: URI,
    region: String,
    bucket: String,
    credentials: R2Credentials,
    apiCallTimeout: Duration,
    apiCallAttemptTimeout: Duration,
    maxAttempts: Int,
)

object R2SourceImageObjectStorageConfig:
  def create(
      endpoint: URI,
      region: String,
      bucket: String,
      credentials: R2Credentials,
      apiCallTimeout: Duration,
      apiCallAttemptTimeout: Duration,
      maxAttempts: Int,
  ): Either[String, R2SourceImageObjectStorageConfig] =
    val endpointScheme = Option(endpoint.getScheme).map(_.toLowerCase)
    val endpointHost = Option(endpoint.getHost).filter(_.nonEmpty)
    val endpointIsAllowed = endpointScheme.contains("https") ||
      (endpointScheme.contains("http") && endpointHost.exists(isLoopbackHost))
    val bucketIsSafe = bucket.length >= 3 && bucket.length <= 63 &&
      bucket.forall(character =>
        (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') ||
          character == '-'
      ) && bucket.headOption.exists(_.isLetterOrDigit) &&
      bucket.lastOption.exists(_.isLetterOrDigit)
    val valid = endpointIsAllowed && endpoint.getPath.toString.isEmpty && region.nonEmpty &&
      bucketIsSafe && !apiCallTimeout.isNegative && !apiCallTimeout.isZero &&
      !apiCallAttemptTimeout.isNegative && !apiCallAttemptTimeout.isZero &&
      apiCallTimeout.compareTo(apiCallAttemptTimeout) >= 0 && maxAttempts >= 1 && maxAttempts <= 2

    Either.cond(
      valid,
      R2SourceImageObjectStorageConfig(
        endpoint,
        region,
        bucket,
        credentials,
        apiCallTimeout,
        apiCallAttemptTimeout,
        maxAttempts,
      ),
      "R2 object storage configuration is invalid.",
    )

  private def isLoopbackHost(host: String): Boolean =
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
