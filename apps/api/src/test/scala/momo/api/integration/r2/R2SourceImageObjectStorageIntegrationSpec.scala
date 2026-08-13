package momo.api.integration.r2

import java.net.URI
import java.time.Duration
import java.util.UUID

import cats.effect.IO
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.storage.r2.{
  R2Credentials,
  R2SourceImageObjectStorage as R2Storage,
  R2SourceImageObjectStorageConfig
}
import momo.api.domain.ids.ImageId
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectFailure, SourceImageObjectKey}
import momo.api.testing.{TestImages, TestTags}

/**
 * Opt-in probe against an isolated R2 bucket.
 *
 * This suite is excluded from normal tests. Run `sbt apiR2Quality` with all required environment
 * variables set. Missing configuration is an explicit failure; the probe never silently skips.
 */
final class R2SourceImageObjectStorageIntegrationSpec extends MomoCatsEffectSuite:
  test("put, head, get, delete, and post-delete head preserve the live R2 contract"
    .tag(TestTags.Integration).tag(TestTags.R2Integration)):
    val config = loadConfig().fold(fail(_), identity)
    val bytes = TestImages.png1x1
    val sha256 = Sha256Hex.digest(bytes)
    val imageId = ImageId.unsafeFromString(UUID.randomUUID().toString)
    val key = SourceImageObjectKey.forImage(imageId, "png").fold(fail(_), identity)

    R2Storage.resource[IO](config).use { storage =>
      val probe =
        for
          put <- storage.put(key, "image/png", bytes, sha256).flatMap(expectRight("put"))
          head <- storage.head(key).flatMap(expectRight("head"))
          get <- storage.get(key).flatMap(expectRight("get"))
          _ <- IO {
            assertEquals(put.key, key)
            assertEquals(put.sha256, sha256)
            assertEquals(head.sha256, sha256)
            assertEquals(head.sizeBytes, bytes.length.toLong)
            assertEquals(get.metadata.sha256, sha256)
            assertEquals(get.bytes.toList, bytes.toList)
          }
          _ <- storage.delete(key).flatMap(expectRight("delete"))
          missing <- storage.head(key)
          _ <- IO(assertEquals(missing, Left(SourceImageObjectFailure.NotFound)))
        yield ()

      probe.attempt.flatMap {
        case Right(_) => IO.unit
        case Left(probeFailure) =>
          storage.delete(key).attempt *> IO.raiseError[Unit](probeFailure)
      }
    }

  private def loadConfig(): Either[String, R2SourceImageObjectStorageConfig] =
    for
      endpoint <- requiredEnv("SOURCE_IMAGE_R2_ENDPOINT").flatMap(parseEndpoint)
      bucket <- requiredEnv("SOURCE_IMAGE_R2_BUCKET")
      accessKeyId <- requiredEnv("SOURCE_IMAGE_R2_ACCESS_KEY_ID")
      secretAccessKey <- requiredEnv("SOURCE_IMAGE_R2_SECRET_ACCESS_KEY")
      credentials <- R2Credentials.fromStrings(accessKeyId, secretAccessKey)
      config <- R2SourceImageObjectStorageConfig.create(
        endpoint,
        region = "auto",
        bucket,
        credentials,
        apiCallTimeout = Duration.ofSeconds(20),
        apiCallAttemptTimeout = Duration.ofSeconds(10),
        maxAttempts = 2,
      )
    yield config

  private def requiredEnv(name: String): Either[String, String] =
    sys.env.get(name).map(_.trim).filter(_.nonEmpty)
      .toRight(s"Required R2 integration environment variable is missing: $name")

  private def parseEndpoint(value: String): Either[String, URI] = Either
    .catchOnly[IllegalArgumentException](URI.create(value))
    .leftMap(_ => "SOURCE_IMAGE_R2_ENDPOINT must be a valid URI.")

  private def expectRight[A](operation: String)(
      result: Either[SourceImageObjectFailure, A]
  ): IO[A] = result.leftMap(failure =>
    new RuntimeException(s"Live R2 $operation failed: $failure")
  ).liftTo[IO]
