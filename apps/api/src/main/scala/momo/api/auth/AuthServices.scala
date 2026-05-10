package momo.api.auth

import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.net.{URI, URLEncoder}
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

import cats.Functor
import cats.effect.std.SecureRandom
import cats.effect.{Async, Ref, Resource, Sync}
import cats.syntax.all.*
import io.circe.Decoder
import io.circe.parser.decode

import momo.api.config.AuthConfig
import momo.api.domain.LoginAccount
import momo.api.errors.AppError
import momo.api.repositories.{AppSession, AppSessionsRepository, LoginAccountsRepository}

final case class DiscordUser(id: String)

trait DiscordOAuthClient[F[_]]:
  def authorizationUrl(state: String): F[String]
  def fetchUser(code: String): F[Either[AppError, DiscordUser]]

final class JavaDiscordOAuthClient[F[_]: Async](config: AuthConfig, client: HttpClient)
    extends DiscordOAuthClient[F]:
  import JavaDiscordOAuthClient.*

  private val authorizeUrl = "https://discord.com/oauth2/authorize"
  private val tokenUrl = "https://discord.com/api/oauth2/token"
  private val userUrl = "https://discord.com/api/users/@me"

  override def authorizationUrl(state: String): F[String] = Async[F].delay {
    val params = Map(
      "client_id" -> config.discordClientId.getOrElse(""),
      "redirect_uri" -> config.discordRedirectUri.getOrElse(""),
      "response_type" -> "code",
      "scope" -> config.discordScope,
      "state" -> state,
    )
    s"$authorizeUrl?${formEncode(params)}"
  }

  override def fetchUser(code: String): F[Either[AppError, DiscordUser]] = exchangeToken(code)
    .flatMap {
      case Left(error) => Async[F].pure(Left(error))
      case Right(accessToken) => fetchUserInfo(accessToken)
    }

  private def exchangeToken(code: String): F[Either[AppError, String]] = Async[F].blocking {
    val body = formEncode(Map(
      "client_id" -> config.discordClientId.getOrElse(""),
      "client_secret" -> config.discordClientSecret.getOrElse(""),
      "grant_type" -> "authorization_code",
      "code" -> code,
      "redirect_uri" -> config.discordRedirectUri.getOrElse(""),
    ))
    val request = HttpRequest.newBuilder(URI.create(tokenUrl))
      .header("Content-Type", "application/x-www-form-urlencoded").timeout(RequestTimeout)
      .POST(HttpRequest.BodyPublishers.ofString(body)).build()
    val response = client.send(request, HttpResponse.BodyHandlers.ofString())
    if response.statusCode() / 100 != 2 then
      Left(AppError.Forbidden("Discord OAuth token exchange failed."))
    else
      decode[TokenResponse](response.body())
        .leftMap(_ => AppError.Forbidden("Discord OAuth token response could not be parsed."))
        .map(_.accessToken)
  }

  private def fetchUserInfo(accessToken: String): F[Either[AppError, DiscordUser]] = Async[F]
    .blocking {
      val request = HttpRequest.newBuilder(URI.create(userUrl))
        .header("Authorization", s"Bearer $accessToken").timeout(RequestTimeout).GET().build()
      val response = client.send(request, HttpResponse.BodyHandlers.ofString())
      if response.statusCode() / 100 != 2 then
        Left(AppError.Forbidden("Discord user lookup failed."))
      else
        decode[DiscordUserResponse](response.body())
          .leftMap(_ => AppError.Forbidden("Discord user response could not be parsed."))
          .map(user => DiscordUser(user.id))
    }

  private def formEncode(params: Map[String, String]): String = params
    .map((key, value) => s"${urlEncode(key)}=${urlEncode(value)}").mkString("&")

  private def urlEncode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

  private final case class TokenResponse(accessToken: String)
  private object TokenResponse:
    given Decoder[TokenResponse] = Decoder.forProduct1("access_token")(TokenResponse(_))

  private final case class DiscordUserResponse(id: String)
  private object DiscordUserResponse:
    given Decoder[DiscordUserResponse] = Decoder.forProduct1("id")(DiscordUserResponse(_))

object JavaDiscordOAuthClient:
  private val ConnectTimeout = java.time.Duration.ofSeconds(5)
  private val RequestTimeout = java.time.Duration.ofSeconds(8)

  def resource[F[_]: Async](config: AuthConfig): Resource[F, JavaDiscordOAuthClient[F]] = Resource
    .fromAutoCloseable(
      Sync[F].delay(HttpClient.newBuilder().connectTimeout(ConnectTimeout).build())
    ).map(new JavaDiscordOAuthClient[F](config, _))

final case class CreatedSession(cookieValue: String)

final case class AuthenticatedSession(
    account: AuthenticatedAccount,
    session: AppSession,
    csrfToken: String,
)

final class SessionService[F[_]: Sync: SecureRandom](
    sessions: AppSessionsRepository[F],
    accounts: LoginAccountsRepository[F],
    config: AuthConfig,
    now: F[Instant],
):
  def create(account: LoginAccount): F[CreatedSession] =
    for
      current <- now
      id <- SecureTokenGenerator.token[F](32)
      csrf <- SecureTokenGenerator.token[F](32)
      idHash <- SessionTokenHash.sha256[F](id)
      csrfHash <- SessionTokenHash.sha256[F](csrf)
      session = AppSession(
        idHash = idHash,
        accountId = account.id,
        playerMemberId = account.playerMemberId,
        csrfSecretHash = csrfHash,
        createdAt = current,
        lastSeenAt = current,
        expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
      )
      _ <- sessions.upsert(session)
    yield CreatedSession(SessionCookieCodec.encode(SessionCookieTokens(id, csrf)))

  def authenticate(sessionCookie: Option[String]): F[Either[AppError, AuthenticatedSession]] =
    sessionCookie.flatMap(SessionCookieCodec.decode) match
      case None => Sync[F].pure(Left(AppError.Unauthorized()))
      case Some(tokens) =>
        for
          current <- now
          idHash <- SessionTokenHash.sha256[F](tokens.sessionToken)
          csrfMatches <- SessionTokenHash.matches[F](tokens.csrfToken)
          maybeSession <- sessions.find(idHash)
          result <- maybeSession match
            case None => Sync[F].pure(Left(AppError.Unauthorized()))
            case Some(session) if !session.expiresAt.isAfter(current) =>
              sessions.delete(session.idHash)
                .as(Left(AppError.Unauthorized("Session has expired.")))
            case Some(session) if !csrfMatches(session.csrfSecretHash) =>
              Sync[F].pure(Left(AppError.Unauthorized()))
            case Some(session) => accounts.find(session.accountId).flatMap {
                case None => sessions.delete(session.idHash).as(Left(AppError.Unauthorized()))
                case Some(account) if !account.loginEnabled =>
                  sessions.delete(session.idHash)
                    .as(Left(AppError.Forbidden("This account is not allowed to log in.")))
                case Some(account) =>
                  val renewed = session.copy(
                    lastSeenAt = current,
                    expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
                  )
                  val accountAuth = AuthenticatedAccount(
                    account.id,
                    account.displayName,
                    account.isAdmin,
                    account.playerMemberId,
                  )
                  if shouldRenew(session, current) then
                    sessions.renew(renewed.idHash, renewed.lastSeenAt, renewed.expiresAt)
                      .as(Right(AuthenticatedSession(accountAuth, renewed, tokens.csrfToken)))
                  else
                    Sync[F]
                      .pure(Right(AuthenticatedSession(accountAuth, session, tokens.csrfToken)))
              }
        yield result

  def delete(idHash: String): F[Unit] = sessions.delete(idHash)

  private def shouldRenew(session: AppSession, current: Instant): Boolean = current
    .isAfter(session.expiresAt.minusSeconds(config.sessionTtl.toSeconds / 2L))

final class CsrfTokenService:
  def issue(authenticated: AuthenticatedSession): String = authenticated.csrfToken

  def verify(session: AppSession, token: Option[String]): Either[AppError, Unit] = token match
    case Some(value) if SessionTokenHash.matchesUnsafe(value, session.csrfSecretHash) => Right(())
    case _ => Left(AppError.Forbidden("A valid CSRF token is required."))

final class OAuthStateCodec[F[_]: Sync: SecureRandom](config: AuthConfig, now: F[Instant]):
  private val separator = "."

  def create: F[String] =
    for
      current <- now
      nonce <- SecureTokenGenerator.token[F](24)
      payload = s"$nonce:${current.plusSeconds(config.stateTtl.toSeconds).getEpochSecond}"
      sig <- sign(payload)
    yield s"${Base64Url.encode(payload.getBytes(StandardCharsets.UTF_8))}$separator$sig"

  def validate(value: String): F[Boolean] = value.split("\\.", 2).toList match
    case payloadEncoded :: signature :: Nil =>
      val decoded = Base64Url.decode(payloadEncoded)
      decoded match
        case None => Sync[F].pure(false)
        case Some(payloadBytes) =>
          val payload = String(payloadBytes, StandardCharsets.UTF_8)
          payload.split(":", 2).toList match
            case _ :: expires :: Nil => (now, sign(payload)).mapN { (current, expected) =>
                expires.toLongOption.exists(_ > current.getEpochSecond) && MessageDigest.isEqual(
                  signature.getBytes(StandardCharsets.UTF_8),
                  expected.getBytes(StandardCharsets.UTF_8),
                )
              }
            case _ => Sync[F].pure(false)
    case _ => Sync[F].pure(false)

  private def sign(payload: String): F[String] = Sync[F].delay {
    val key = config.stateSigningKey.getOrElse("development-only-oauth-state-signing-key")
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
    Base64Url.encode(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)))
  }

final class LoginRateLimiter[F[_]: Sync] private (
    ref: Ref[F, Map[String, LoginRateLimiter.Bucket]],
    maxPerMinute: Int,
    now: F[Instant],
    retainWindows: Long,
):
  def allow(key: String): F[Boolean] =
    for
      current <- now
      allowed <- ref.modify { buckets =>
        val minute = current.getEpochSecond / 60
        val retained = buckets.filter { case (_, bucket) => minute - bucket.minute < retainWindows }
        val bucket = retained.getOrElse(key, LoginRateLimiter.Bucket(minute, 0))
        val next =
          if bucket.minute == minute then bucket.copy(count = bucket.count + 1)
          else LoginRateLimiter.Bucket(minute, 1)
        val limited = next.count > maxPerMinute
        (retained.updated(key, next), !limited)
      }
    yield allowed

  private[auth] def bucketCount: F[Int] = ref.get.map(_.size)

object LoginRateLimiter:
  final case class Bucket(minute: Long, count: Int)

  def create[F[_]: Sync](maxPerMinute: Int, now: F[Instant]): F[LoginRateLimiter[F]] = Ref
    .of[F, Map[String, Bucket]](Map.empty).map(LoginRateLimiter(_, maxPerMinute, now, 2L))

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
