package momo.api.auth

import java.nio.charset.StandardCharsets
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

import scala.concurrent.duration.*

import cats.effect.IO

import momo.api.MomoCatsEffectSuite

final class OAuthStateCodecSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private val key = "test-state-format-key"
  private val codec = OAuthStateCodec[IO](key, 5.minutes, IO.pure(now))

  private def signed(payload: String): IO[String] = IO {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
    val bytes = payload.getBytes(StandardCharsets.UTF_8)
    s"${Base64Url.encode(bytes)}.${Base64Url.encode(mac.doFinal(bytes))}"
  }

  test("new states carry a signed format version and preserve their payload") {
    for
      state <- codec.create(silent = true, redirectPath = Some("/matches"))
      payload = Base64Url.decode(state.takeWhile(_ != '.'))
        .map(bytes => String(bytes, StandardCharsets.UTF_8))
      result <- codec.validate(state)
    yield
      assert(payload.exists(_.startsWith("v2:")))
      assertEquals(result, Some(codec.Payload(true, Some("/matches"), now.plusSeconds(300))))
  }

  test("previous and unknown formats are rejected even with a valid signature and future expiry") {
    val expires = now.plusSeconds(300).getEpochSecond
    for
      legacy <- signed(s"nonce:$expires:0:")
      unknown <- signed(s"v3:nonce:$expires:0:")
      legacyResult <- codec.validate(legacy)
      unknownResult <- codec.validate(unknown)
    yield
      assertEquals(legacyResult, None)
      assertEquals(unknownResult, None)
  }

  test("changing the format marker without resigning cannot upgrade a legacy state") {
    val payload = s"nonce:${now.plusSeconds(300).getEpochSecond}:0:"
    for
      legacy <- signed(payload)
      upgraded = Base64Url.encode(s"v2:$payload".getBytes(StandardCharsets.UTF_8)) +
        legacy.dropWhile(_ != '.')
      result <- codec.validate(upgraded)
    yield assertEquals(result, None)
  }
