package momo.api.adapters.storage.r2

import java.net.{InetSocketAddress, URI}
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.Base64
import java.util.concurrent.atomic.{AtomicBoolean, AtomicReference}

import cats.effect.{IO, Resource}
import com.sun.net.httpserver.HttpServer

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.ImageId
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectFailure, SourceImageObjectKey}
import momo.api.testing.TestImages

/** Exercises the production SDK and HTTP transport against a disposable loopback service. */
final class R2SourceImageWireSpec extends MomoCatsEffectSuite:
  test("the SDK sends conditional creates and reconciles a wire-level precondition failure") {
    val bytes = TestImages.png1x1
    val checksum = Sha256Hex.digest(bytes)
    val checksumBase64 =
      Base64.getEncoder.encodeToString(java.util.HexFormat.of().parseHex(checksum.value))
    val exists = AtomicBoolean(false)
    val conditions = AtomicReference[List[Option[String]]](Nil)
    val key = SourceImageObjectKey.forImage(ImageId.unsafeFromString("wire-test"), "png")
      .fold(fail(_), identity)
    val server = Resource.make(IO.blocking {
      val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
      val _ = http.createContext(
        "/",
        exchange =>
          try
            val input = exchange.getRequestBody
            try
              val _ = input.readAllBytes()
            finally input.close()
            val (status, response) = exchange.getRequestMethod match
              case "PUT" =>
                val condition = Option(exchange.getRequestHeaders.getFirst("If-None-Match"))
                val _ = conditions.updateAndGet(condition :: _)
                if exists.getAndSet(true) && condition.contains("*") then
                  412 -> "<Error><Code>PreconditionFailed</Code></Error>".getBytes(UTF_8)
                else
                  exchange.getResponseHeaders.set("ETag", "\"wire-etag\"")
                  exchange.getResponseHeaders.set("x-amz-checksum-sha256", checksumBase64)
                  200 -> Array.emptyByteArray
              case "GET" =>
                exchange.getResponseHeaders.set("Content-Type", "image/png")
                exchange.getResponseHeaders.set("ETag", "\"wire-etag\"")
                exchange.getResponseHeaders.set("x-amz-meta-momo-sha256", checksum.value)
                exchange.getResponseHeaders.set("x-amz-checksum-sha256", checksumBase64)
                200 -> bytes
              case _ => 405 -> Array.emptyByteArray
            exchange.sendResponseHeaders(
              status,
              if response.isEmpty then -1L else response.length.toLong
            )
            if response.nonEmpty then exchange.getResponseBody.write(response)
          finally exchange.close()
      )
      http.start()
      http
    })(http => IO.blocking(http.stop(0)))

    server.use { http =>
      val credentials =
        R2Credentials.fromStrings("test-access", "test-secret").fold(fail(_), identity)
      val config = R2SourceImageObjectStorageConfig.create(
        URI.create(s"http://127.0.0.1:${http.getAddress.getPort}"),
        "auto",
        "wire-test",
        credentials,
        Duration.ofSeconds(10),
        Duration.ofSeconds(5),
        1,
      ).fold(fail(_), identity)
      R2SourceImageObjectStorage.resource[IO](config).use { storage =>
        val other = TestImages.png(2, 1)
        for
          first <- storage.put(key, "image/png", bytes, checksum)
          replay <- storage.put(key, "image/png", bytes, checksum)
          conflict <- storage.put(key, "image/png", other, Sha256Hex.digest(other))
        yield
          assert(first.isRight)
          assertEquals(replay, first)
          assertEquals(conflict, Left(SourceImageObjectFailure.IntegrityViolation))
          assertEquals(conditions.get(), List.fill(3)(Some("*")))
      }
    }
  }
