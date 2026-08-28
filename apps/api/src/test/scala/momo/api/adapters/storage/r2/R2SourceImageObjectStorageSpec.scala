package momo.api.adapters.storage.r2

import java.io.ByteArrayInputStream
import java.net.URI
import java.time.Duration
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}

import scala.util.Failure

import cats.effect.IO
import software.amazon.awssdk.core.ResponseInputStream
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.*

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.ImageId
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectFailure, SourceImageObjectKey}
import momo.api.testing.TestImages

final class R2SourceImageObjectStorageSpec extends MomoCatsEffectSuite:
  private val bucket = "momo-result-source-images"
  private val key = SourceImageObjectKey
    .forImage(ImageId.unsafeFromString("018f50e2-88aa-7d1d-a8a6-9f3f8cf58d90"), "png")
    .fold(fail(_), identity)
  private val bytes = TestImages.png1x1
  private val sha256 = Sha256Hex.digest(bytes)

  test("put, head, get, and idempotent delete preserve source image integrity"):
    val client = StubS3Client()
    val storage = R2SourceImageObjectStorage.fromClient[IO](client, bucket)

    for
      put <- storage.put(key, "image/png", bytes, sha256)
      head <- storage.head(key)
      get <- storage.get(key)
      deleted <- storage.delete(key)
      deletedAgain <- storage.delete(key)
      missing <- storage.head(key)
    yield
      assertEquals(put.map(_.sha256), Right(sha256))
      assertEquals(head.map(_.sizeBytes), Right(bytes.length.toLong))
      assertEquals(get.map(_.metadata.mediaType), Right("image/png"))
      assertEquals(get.map(_.bytes.toList), Right(bytes.toList))
      assertEquals(deleted, Right(()))
      assertEquals(deletedAgain, Right(()))
      assertEquals(missing, Left(SourceImageObjectFailure.NotFound))

  test("put fails before I/O when the expected checksum does not match"):
    val client = StubS3Client()
    val storage = R2SourceImageObjectStorage.fromClient[IO](client, bucket)
    val wrongSha256 = Sha256Hex.digest(Array[Byte](1, 2, 3))

    storage.put(key, "image/png", bytes, wrongSha256).map { result =>
      assertEquals(result, Left(SourceImageObjectFailure.IntegrityViolation))
      assertEquals(client.putCalls, 0)
    }

  test("get rejects content modified after upload"):
    val client = StubS3Client()
    val storage = R2SourceImageObjectStorage.fromClient[IO](client, bucket)

    for
      stored <- storage.put(key, "image/png", bytes, sha256)
      _ = assert(stored.isRight)
      _ = client.tamperBody(Array[Byte](1, 2, 3))
      result <- storage.get(key)
    yield assertEquals(result, Left(SourceImageObjectFailure.IntegrityViolation))

  test("provider status codes are mapped without leaking provider errors"):
    val forbiddenClient = StubS3Client()
    forbiddenClient.failNext(403)
    val unavailableClient = StubS3Client()
    unavailableClient.failNext(503)
    val forbiddenStorage = R2SourceImageObjectStorage.fromClient[IO](forbiddenClient, bucket)
    val unavailableStorage = R2SourceImageObjectStorage.fromClient[IO](unavailableClient, bucket)

    for
      forbidden <- forbiddenStorage.head(key)
      unavailable <- unavailableStorage.head(key)
    yield
      assertEquals(forbidden, Left(SourceImageObjectFailure.AccessDenied))
      assertEquals(unavailable, Left(SourceImageObjectFailure.Unavailable))

  test("R2 configuration rejects remote plaintext endpoints and more than two attempts"):
    val credentials = R2Credentials.fromStrings("access", "secret").fold(fail(_), identity)
    val valid = R2SourceImageObjectStorageConfig.create(
      URI.create("https://account.r2.cloudflarestorage.com"),
      "auto",
      bucket,
      credentials,
      Duration.ofSeconds(10),
      Duration.ofSeconds(5),
      maxAttempts = 2,
    )
    val plaintext = R2SourceImageObjectStorageConfig.create(
      URI.create("http://account.r2.cloudflarestorage.com"),
      "auto",
      bucket,
      credentials,
      Duration.ofSeconds(10),
      Duration.ofSeconds(5),
      maxAttempts = 2,
    )
    val excessiveRetries = R2SourceImageObjectStorageConfig.create(
      URI.create("https://account.r2.cloudflarestorage.com"),
      "auto",
      bucket,
      credentials,
      Duration.ofSeconds(10),
      Duration.ofSeconds(5),
      maxAttempts = 3,
    )

    assert(valid.isRight)
    assert(plaintext.isLeft)
    assert(excessiveRetries.isLeft)
    assert(!credentials.toString.contains("access"))
    assert(!credentials.toString.contains("secret"))
    val rendered = valid.fold(fail(_), _.toString)
    assert(!rendered.contains("account.r2.cloudflarestorage.com"))
    assert(!rendered.contains(bucket))
    assert(rendered.contains("[REDACTED]"))

  private final case class StoredObject(
      contentType: String,
      metadata: java.util.Map[String, String],
      bytes: Array[Byte],
  )

  private final class StubS3Client extends S3Client:
    private val maybeStored = AtomicReference[Option[StoredObject]](None)
    private val nextStatus = AtomicReference[Option[Int]](None)
    private val putCallCount = AtomicInteger(0)

    def putCalls: Int = putCallCount.get()

    def tamperBody(tampered: Array[Byte]): Unit =
      val _ = maybeStored.updateAndGet(_.map(_.copy(bytes = tampered)))
      ()

    def failNext(status: Int): Unit = nextStatus.set(Some(status))

    override def serviceName(): String = "s3"

    override def close(): Unit = ()

    override def putObject(request: PutObjectRequest, requestBody: RequestBody): PutObjectResponse =
      raisePendingFailure()
      val _ = putCallCount.incrementAndGet()
      val input = requestBody.contentStreamProvider().newStream()
      val requestBytes = try input.readAllBytes()
      finally input.close()
      maybeStored.set(Some(StoredObject(
        request.contentType(),
        request.metadata(),
        requestBytes,
      )))
      PutObjectResponse.builder().checksumSHA256(request.checksumSHA256()).eTag("etag-1").build()

    override def headObject(_request: HeadObjectRequest): HeadObjectResponse =
      raisePendingFailure()
      val stored = maybeStored.get().getOrElse(Failure[StoredObject](notFound()).get)
      HeadObjectResponse.builder().contentType(stored.contentType)
        .contentLength(stored.bytes.length.toLong).metadata(stored.metadata).eTag("etag-1").build()

    override def getObject(
        _request: GetObjectRequest
    ): ResponseInputStream[GetObjectResponse] =
      raisePendingFailure()
      val stored = maybeStored.get().getOrElse(Failure[StoredObject](notFound()).get)
      val response = GetObjectResponse.builder().contentType(stored.contentType)
        .contentLength(stored.bytes.length.toLong).metadata(stored.metadata).eTag("etag-1").build()
      ResponseInputStream(response, ByteArrayInputStream(stored.bytes))

    override def deleteObject(_request: DeleteObjectRequest): DeleteObjectResponse =
      raisePendingFailure()
      maybeStored.set(None)
      DeleteObjectResponse.builder().build()

    private def raisePendingFailure(): Unit = nextStatus.getAndSet(None).foreach { status =>
      val error = S3Exception.builder().statusCode(status).message("provider failure").build()
      val _ = Failure[Unit](error).get
    }

    private def notFound(): Throwable = S3Exception.builder().statusCode(404)
      .message("not found").build()

  private object StubS3Client:
    def apply(): StubS3Client = new StubS3Client()
