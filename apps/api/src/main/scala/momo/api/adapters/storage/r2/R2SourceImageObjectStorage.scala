package momo.api.adapters.storage.r2

import java.io.InputStream
import java.util.Base64

import scala.jdk.CollectionConverters.*

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.core.checksums.{RequestChecksumCalculation, ResponseChecksumValidation}
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.retries.DefaultRetryStrategy
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.*

import momo.api.adapters.storage.ImageValidation
import momo.api.ports.storage.{
  Sha256Hex,
  SourceImageObject,
  SourceImageObjectFailure,
  SourceImageObjectKey,
  SourceImageObjectMetadata,
  SourceImageObjectStorage
}

final class R2SourceImageObjectStorage[F[_]: Async] private[r2] (
    client: S3Client,
    bucket: String,
) extends SourceImageObjectStorage[F]:
  import R2SourceImageObjectStorage.*

  override def put(
      key: SourceImageObjectKey,
      mediaType: String,
      bytes: Array[Byte],
      sha256: Sha256Hex,
  ): F[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] =
    validatePut(mediaType, bytes, sha256) match
      case Left(failure) => Async[F].pure(Left(failure))
      case Right(checksumBase64) => run {
          val request = PutObjectRequest.builder().bucket(bucket).key(key.value)
            .contentType(mediaType).contentLength(bytes.length.toLong)
            .checksumSHA256(checksumBase64).metadata(Map(Sha256MetadataKey -> sha256.value).asJava)
            .build()
          val response = client.putObject(request, RequestBody.fromBytes(bytes))
          Either.cond(
            Option(response.checksumSHA256()).forall(_ == checksumBase64),
            SourceImageObjectMetadata(
              key,
              mediaType,
              bytes.length.toLong,
              sha256,
              Option(response.eTag()),
            ),
            SourceImageObjectFailure.IntegrityViolation,
          )
        }

  override def head(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] = run {
    val response = client.headObject(HeadObjectRequest.builder().bucket(bucket).key(key.value).build())
    metadata(
      key,
      response.contentType(),
      response.contentLength(),
      response.metadata(),
      response.eTag(),
    )
  }

  override def get(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, SourceImageObject]] = run {
    val responseStream = client.getObject(
      GetObjectRequest.builder().bucket(bucket).key(key.value).build()
    )
    try readAndValidate(key, responseStream.response(), responseStream)
    finally responseStream.close()
  }

  override def delete(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, Unit]] = Async[F].blocking {
    try
      val _ = client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key.value).build())
      Right(())
    catch
      case error: Throwable if failureFor(error) == SourceImageObjectFailure.NotFound => Right(())
      case error: Throwable => Left(failureFor(error))
  }

  private def run[A](operation: => Either[SourceImageObjectFailure, A]): F[Either[
    SourceImageObjectFailure,
    A,
  ]] = Async[F].blocking(operation).handleError(error => Left(failureFor(error)))

object R2SourceImageObjectStorage:
  private val Sha256MetadataKey = "momo-sha256"
  private val AllowedMediaTypes = Set("image/png", "image/jpeg", "image/webp")

  def resource[F[_]: Async](
      config: R2SourceImageObjectStorageConfig
  ): Resource[F, R2SourceImageObjectStorage[F]] = Resource
    .make(Async[F].blocking(buildClient(config)))(client => Async[F].blocking(client.close()))
    .map(client => R2SourceImageObjectStorage(client, config.bucket))

  private[r2] def fromClient[F[_]: Async](
      client: S3Client,
      bucket: String,
  ): R2SourceImageObjectStorage[F] = R2SourceImageObjectStorage(client, bucket)

  private def buildClient(config: R2SourceImageObjectStorageConfig): S3Client =
    val credentials = AwsBasicCredentials.create(
      config.credentials.accessKeyId,
      config.credentials.secretAccessKey,
    )
    val retryStrategy = DefaultRetryStrategy.standardStrategyBuilder()
      .maxAttempts(config.maxAttempts).build()

    S3Client.builder().endpointOverride(config.endpoint).region(Region.of(config.region))
      .credentialsProvider(StaticCredentialsProvider.create(credentials))
      .httpClientBuilder(
        UrlConnectionHttpClient.builder().connectionTimeout(config.apiCallAttemptTimeout)
          .socketTimeout(config.apiCallAttemptTimeout)
      )
      .overrideConfiguration { builder =>
        val _ = builder.apiCallTimeout(config.apiCallTimeout)
          .apiCallAttemptTimeout(config.apiCallAttemptTimeout).retryStrategy(retryStrategy)
        ()
      }
      .requestChecksumCalculation(RequestChecksumCalculation.WHEN_SUPPORTED)
      .responseChecksumValidation(ResponseChecksumValidation.WHEN_SUPPORTED).forcePathStyle(true)
      .build()

  private def validatePut(
      mediaType: String,
      bytes: Array[Byte],
      expectedSha256: Sha256Hex,
  ): Either[SourceImageObjectFailure, String] =
    val actualSha256 = Sha256Hex.digest(bytes)
    Either.cond(
      bytes.nonEmpty && bytes.length <= ImageValidation.MaxBytes &&
        AllowedMediaTypes.contains(mediaType) && actualSha256 == expectedSha256,
      Base64.getEncoder.encodeToString(hexToBytes(expectedSha256.value)),
      SourceImageObjectFailure.IntegrityViolation,
    )

  private def metadata(
      key: SourceImageObjectKey,
      rawMediaType: String,
      sizeBytes: Long,
      rawMetadata: java.util.Map[String, String],
      rawEtag: String,
  ): Either[SourceImageObjectFailure, SourceImageObjectMetadata] =
    val mediaType = Option(rawMediaType).map(ImageValidation.normalizeMediaType)
    val sha256 = Option(rawMetadata).flatMap(metadata =>
      Option(metadata.get(Sha256MetadataKey)).flatMap(Sha256Hex.fromString(_).toOption)
    )
    (mediaType, sha256) match
      case (Some(validMediaType), Some(validSha256))
          if AllowedMediaTypes.contains(validMediaType) && sizeBytes > 0L &&
            sizeBytes <= ImageValidation.MaxBytes.toLong =>
        Right(SourceImageObjectMetadata(
          key,
          validMediaType,
          sizeBytes,
          validSha256,
          Option(rawEtag),
        ))
      case _ => Left(SourceImageObjectFailure.IntegrityViolation)

  private def readAndValidate(
      key: SourceImageObjectKey,
      response: GetObjectResponse,
      input: InputStream,
  ): Either[SourceImageObjectFailure, SourceImageObject] = metadata(
    key,
    response.contentType(),
    response.contentLength(),
    response.metadata(),
    response.eTag(),
  ).flatMap { objectMetadata =>
    val bytes = input.readNBytes(ImageValidation.MaxBytes + 1)
    Either.cond(
      bytes.length.toLong == objectMetadata.sizeBytes &&
        Sha256Hex.digest(bytes) == objectMetadata.sha256,
      SourceImageObject(objectMetadata, bytes),
      SourceImageObjectFailure.IntegrityViolation,
    )
  }

  private def failureFor(error: Throwable): SourceImageObjectFailure = error match
    case _: NoSuchKeyException => SourceImageObjectFailure.NotFound
    case serviceError: S3Exception if serviceError.statusCode() == 404 =>
      SourceImageObjectFailure.NotFound
    case serviceError: S3Exception
        if serviceError.statusCode() == 401 || serviceError.statusCode() == 403 =>
      SourceImageObjectFailure.AccessDenied
    case _ => SourceImageObjectFailure.Unavailable

  private def hexToBytes(value: String): Array[Byte] = value.grouped(2)
    .map(Integer.parseInt(_, 16).toByte).toArray
