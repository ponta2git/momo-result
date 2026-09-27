package momo.api.auth

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import cats.Functor
import cats.effect.Sync
import cats.effect.std.SecureRandom
import cats.syntax.all.*

object SecureTokenGenerator:
  def token[F[_]: Functor: SecureRandom](byteLength: Int): F[String] = SecureRandom[F]
    .nextBytes(byteLength).map(Base64Url.encode)

final case class SessionCookieTokens(sessionToken: String, csrfToken: String)

object SessionCookieCodec:
  private val Version = "v1"
  private val Separator = "."
  private val TokenLength = 43
  private val CookieLength = Version.length + 2 + 2 * TokenLength

  def encode(tokens: SessionCookieTokens): String =
    s"$Version$Separator${tokens.sessionToken}$Separator${tokens.csrfToken}"

  def decode(value: String): Option[SessionCookieTokens] =
    if value.length != CookieLength then None
    else
      value.split("\\.", -1).toList match
        case Version :: sessionToken :: csrfToken :: Nil
            if validToken(sessionToken) && validToken(csrfToken) =>
          Some(SessionCookieTokens(sessionToken, csrfToken))
        case _ => None

  private def validToken(value: String): Boolean = value.length == TokenLength && value.forall {
    character =>
      (character >= 'A' && character <= 'Z') ||
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9') || character == '-' || character == '_'
  }

object SessionTokenHash:
  def sha256[F[_]: Sync](value: String): F[String] = Sync[F].delay(sha256Unsafe(value))

  def matches[F[_]: Sync](value: String, expected: String): F[Boolean] = sha256(value)
    .map(hash => constantTimeEquals(hash, expected))

  def matchesUnsafe(value: String, expected: String): Boolean =
    constantTimeEquals(sha256Unsafe(value), expected)

  private def sha256Unsafe(value: String): String = Base64Url
    .encode(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))

  private def constantTimeEquals(left: String, right: String): Boolean = MessageDigest
    .isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8))

object Base64Url:
  private val encoder = java.util.Base64.getUrlEncoder.withoutPadding()
  private val decoder = java.util.Base64.getUrlDecoder

  def encode(bytes: Array[Byte]): String = encoder.encodeToString(bytes)

  def decode(value: String): Option[Array[Byte]] = Either.catchNonFatal(decoder.decode(value))
    .toOption
