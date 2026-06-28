package momo.api.auth

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

import cats.effect.Sync
import cats.effect.std.SecureRandom
import cats.syntax.all.*

import momo.api.config.{AuthConfig, RedirectPath}

final class OAuthStateCodec[F[_]: Sync: SecureRandom](config: AuthConfig, now: F[Instant]):
  private val separator = "."
  private val silentMarker = "1"
  private val interactiveMarker = "0"

  final case class Payload(silent: Boolean, redirectPath: Option[String])

  def create(silent: Boolean, redirectPath: Option[String]): F[String] =
    for
      current <- now
      nonce <- SecureTokenGenerator.token[F](24)
      marker = if silent then silentMarker else interactiveMarker
      redirect = redirectPath.flatMap(RedirectPath.sanitize)
        .map(path => Base64Url.encode(path.getBytes(StandardCharsets.UTF_8))).getOrElse("")
      payload =
        s"$nonce:${current.plusSeconds(config.stateTtl.toSeconds).getEpochSecond}:$marker:$redirect"
      sig <- sign(payload)
    yield s"${Base64Url.encode(payload.getBytes(StandardCharsets.UTF_8))}$separator$sig"

  def validate(value: String): F[Option[Payload]] = value.split("\\.", 2).toList match
    case payloadEncoded :: signature :: Nil =>
      val decoded = Base64Url.decode(payloadEncoded)
      decoded match
        case None => Sync[F].pure(None)
        case Some(payloadBytes) =>
          val payload = String(payloadBytes, StandardCharsets.UTF_8)
          payload.split(":", 4).toList match
            case _ :: expires :: marker :: redirect :: Nil =>
              validatePayload(payload, signature, expires, marker, decodeRedirectPath(redirect))
            case _ :: expires :: marker :: Nil =>
              validatePayload(payload, signature, expires, marker, None)
            case _ => Sync[F].pure(None)
    case _ => Sync[F].pure(None)

  private def validatePayload(
      payload: String,
      signature: String,
      expires: String,
      marker: String,
      redirectPath: Option[String],
  ): F[Option[Payload]] = (now, sign(payload)).mapN { (current, expected) =>
    val signatureMatches = MessageDigest.isEqual(
      signature.getBytes(StandardCharsets.UTF_8),
      expected.getBytes(StandardCharsets.UTF_8),
    )
    val notExpired = expires.toLongOption.exists(_ > current.getEpochSecond)
    val silent = marker match
      case `silentMarker` => Some(true)
      case `interactiveMarker` => Some(false)
      case _ => None
    if signatureMatches && notExpired then silent.map(Payload(_, redirectPath)) else None
  }

  private def decodeRedirectPath(value: String): Option[String] = Option.when(value.nonEmpty)(value)
    .flatMap(Base64Url.decode).map(bytes => String(bytes, StandardCharsets.UTF_8))
    .flatMap(RedirectPath.sanitize)

  private def sign(payload: String): F[String] = Sync[F].delay {
    val key = config.stateSigningKey.getOrElse("development-only-oauth-state-signing-key")
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
    Base64Url.encode(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)))
  }
