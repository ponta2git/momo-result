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
import momo.api.errors.AppError
import momo.api.repositories.{AppSession, AppSessionsRepository, MembersRepository}

final case class DiscordUser(id: String)

trait DiscordOAuthClient[F[_]]:
  def authorizationUrl(state: String): F[String]
  def fetchUser(code: String): F[Either[AppError, DiscordUser]]

final class JavaDiscordOAuthClient[F[_]: Async](config: AuthConfig, client: HttpClient)
    extends DiscordOAuthClient[F]:
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
      .header("Content-Type", "application/x-www-form-urlencoded")
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
        .header("Authorization", s"Bearer $accessToken").GET().build()
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
  def resource[F[_]: Async](config: AuthConfig): Resource[F, JavaDiscordOAuthClient[F]] = Resource
    .fromAutoCloseable(Sync[F].delay(HttpClient.newHttpClient()))
    .map(new JavaDiscordOAuthClient[F](config, _))

final case class AuthenticatedSession(member: AuthenticatedMember, session: AppSession)

final class SessionService[F[_]: Sync: SecureRandom](
    sessions: AppSessionsRepository[F],
    members: MembersRepository[F],
    config: AuthConfig,
    now: F[Instant],
):
  def create(member: momo.api.domain.Member): F[AppSession] =
    for
      current <- now
      id <- SecureTokenGenerator.token[F](32)
      csrf <- SecureTokenGenerator.token[F](32)
      session = AppSession(
        id = id,
        memberId = member.id,
        csrfSecret = csrf,
        createdAt = current,
        lastSeenAt = current,
        expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
      )
      _ <- sessions.upsert(session)
    yield session

  def authenticate(sessionId: Option[String]): F[Either[AppError, AuthenticatedSession]] =
    sessionId match
      case None => Sync[F].pure(Left(AppError.Unauthorized()))
      case Some(id) =>
        for
          current <- now
          maybeSession <- sessions.find(id)
          result <- maybeSession match
            case None => Sync[F].pure(Left(AppError.Unauthorized()))
            case Some(session) if !session.expiresAt.isAfter(current) =>
              sessions.delete(session.id).as(Left(AppError.Unauthorized("Session has expired.")))
            case Some(session) => members.find(session.memberId).flatMap {
                case None => Sync[F].pure(Left(AppError.Unauthorized()))
                case Some(member) =>
                  val renewed = session.copy(
                    lastSeenAt = current,
                    expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
                  )
                  sessions.upsert(renewed).as(Right(AuthenticatedSession(
                    AuthenticatedMember(member.id, member.displayName),
                    renewed,
                  )))
              }
        yield result

  def delete(sessionId: String): F[Unit] = sessions.delete(sessionId)

final class CsrfTokenService:
  def issue(session: AppSession): String = session.csrfSecret

  def verify(session: AppSession, token: Option[String]): Either[AppError, Unit] = token match
    case Some(value)
        if MessageDigest.isEqual(
          value.getBytes(StandardCharsets.UTF_8),
          session.csrfSecret.getBytes(StandardCharsets.UTF_8),
        ) => Right(())
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
):
  def allow(key: String): F[Boolean] =
    for
      current <- now
      allowed <- ref.modify { buckets =>
        val minute = current.getEpochSecond / 60
        val bucket = buckets.getOrElse(key, LoginRateLimiter.Bucket(minute, 0))
        val next =
          if bucket.minute == minute then bucket.copy(count = bucket.count + 1)
          else LoginRateLimiter.Bucket(minute, 1)
        val limited = next.count > maxPerMinute
        (buckets.updated(key, next), !limited)
      }
    yield allowed

object LoginRateLimiter:
  final case class Bucket(minute: Long, count: Int)

  def create[F[_]: Sync](maxPerMinute: Int, now: F[Instant]): F[LoginRateLimiter[F]] = Ref
    .of[F, Map[String, Bucket]](Map.empty).map(LoginRateLimiter(_, maxPerMinute, now))

object SecureTokenGenerator:
  def token[F[_]: Functor: SecureRandom](byteLength: Int): F[String] = SecureRandom[F]
    .nextBytes(byteLength).map(Base64Url.encode)

object Base64Url:
  private val encoder = java.util.Base64.getUrlEncoder.withoutPadding()
  private val decoder = java.util.Base64.getUrlDecoder

  def encode(bytes: Array[Byte]): String = encoder.encodeToString(bytes)

  def decode(value: String): Option[Array[Byte]] = Either.catchNonFatal(decoder.decode(value))
    .toOption
