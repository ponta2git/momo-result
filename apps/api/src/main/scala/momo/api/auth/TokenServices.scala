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

  def encode(tokens: SessionCookieTokens): String =
    s"$Version$Separator${tokens.sessionToken}$Separator${tokens.csrfToken}"

  def decode(value: String): Option[SessionCookieTokens] = value.split("\\.", -1).toList match
    case Version :: sessionToken :: csrfToken :: Nil
        if sessionToken.nonEmpty && csrfToken.nonEmpty =>
      Some(SessionCookieTokens(sessionToken, csrfToken))
    case _ => None

object SessionTokenHash:
  def sha256[F[_]: Sync](value: String): F[String] = Sync[F].delay(sha256Unsafe(value))

  def matches[F[_]: Sync](value: String): F[String => Boolean] = sha256(value)
    .map(hash => expected => constantTimeEquals(hash, expected))

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
