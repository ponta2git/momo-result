package momo.api.adapters.discord

import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.net.{URI, URLEncoder}
import java.nio.charset.StandardCharsets

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import io.circe.Decoder
import io.circe.parser.decode
import org.slf4j.LoggerFactory

import momo.api.auth.{DiscordOAuthClient, DiscordUser}
import momo.api.errors.AppError
import momo.api.logging.SafeLog

final class JavaDiscordOAuthClient[F[_]: Async](config: JavaDiscordOAuthClient.Config, client: HttpClient)
    extends DiscordOAuthClient[F]:
  import JavaDiscordOAuthClient.*

  private val authorizeUrl = "https://discord.com/oauth2/authorize"
  private val tokenUrl = "https://discord.com/api/oauth2/token"
  private val userUrl = "https://discord.com/api/users/@me"
  private val logger = LoggerFactory.getLogger("momo.api.auth.JavaDiscordOAuthClient")

  override def authorizationUrl(state: String, prompt: Option[String]): F[String] = Async[F].delay {
    val params = Map(
      "client_id" -> config.clientId,
      "redirect_uri" -> config.redirectUri,
      "response_type" -> "code",
      "scope" -> config.scope,
      "state" -> state,
    ) ++ prompt.map("prompt" -> _)
    s"$authorizeUrl?${formEncode(params)}"
  }

  override def fetchUser(code: String): F[Either[AppError, DiscordUser]] = exchangeToken(code)
    .flatMap {
      case Left(error) => Async[F].pure(Left(error))
      case Right(accessToken) => fetchUserInfo(accessToken)
    }

  private def exchangeToken(code: String): F[Either[AppError, String]] = request[TokenResponse](
    "token_exchange",
    "Discord OAuth token exchange failed.",
    "Discord OAuth token response is invalid.",
  ) {
    val body = formEncode(Map(
      "client_id" -> config.clientId,
      "client_secret" -> config.clientSecret,
      "grant_type" -> "authorization_code",
      "code" -> code,
      "redirect_uri" -> config.redirectUri,
    ))
    HttpRequest.newBuilder(URI.create(tokenUrl))
      .header("Content-Type", "application/x-www-form-urlencoded").timeout(RequestTimeout)
      .POST(HttpRequest.BodyPublishers.ofString(body)).build()
  }.map(_.map(_.accessToken))

  private def fetchUserInfo(accessToken: String): F[Either[AppError, DiscordUser]] =
    request[DiscordUserResponse](
      "user_lookup",
      "Discord user lookup failed.",
      "Discord user response is invalid.",
    ) {
      HttpRequest.newBuilder(URI.create(userUrl))
        .header("Authorization", s"Bearer $accessToken").timeout(RequestTimeout).GET().build()
    }.map(_.map(user => DiscordUser(user.id)))

  private def request[A: Decoder](operation: String, forbiddenDetail: String, invalidDetail: String)(
      build: => HttpRequest
  ): F[Either[AppError, A]] = Async[F].interruptible {
    Either.catchNonFatal {
      val response = client.send(build, HttpResponse.BodyHandlers.ofString())
      if response.statusCode() / 100 != 2 then
        Left(statusError(operation, response.statusCode(), forbiddenDetail))
      else decode[A](response.body()).leftMap(_ => parseError(operation, invalidDetail))
    }.leftMap(error => transportError(operation, error)).flatten
  }

  private def formEncode(params: Map[String, String]): String = params
    .map((key, value) => s"${urlEncode(key)}=${urlEncode(value)}").mkString("&")

  private def urlEncode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

  private def statusError(operation: String, status: Int, forbiddenDetail: String): AppError =
    if status == 429 || status >= 500 then
      logger.error(s"Discord OAuth provider error operation=$operation status=${status.toString}")
      AppError.DependencyFailed("Discord OAuth provider request failed.")
    else AppError.Forbidden(forbiddenDetail)

  private def parseError(operation: String, detail: String): AppError =
    logger.error(s"Discord OAuth provider response parse failed operation=$operation")
    AppError.DependencyFailed(detail)

  private def transportError(operation: String, error: Throwable): AppError =
    val classes = SafeLog.throwableClasses(error)
    logger
      .error(s"Discord OAuth provider request failed operation=$operation errorClasses=$classes")
    AppError.DependencyFailed("Discord OAuth provider request failed.")

  private final case class TokenResponse(accessToken: String)
  private object TokenResponse:
    given Decoder[TokenResponse] = Decoder.forProduct1("access_token")(TokenResponse(_))

  private final case class DiscordUserResponse(id: String)
  private object DiscordUserResponse:
    given Decoder[DiscordUserResponse] = Decoder.forProduct1("id")(DiscordUserResponse(_))

object JavaDiscordOAuthClient:
  final case class Config(clientId: String, clientSecret: String, redirectUri: String, scope: String):
    override def toString: String = "DiscordOAuthClient.Config([REDACTED])"

  private val ConnectTimeout = java.time.Duration.ofSeconds(5)
  private val RequestTimeout = java.time.Duration.ofSeconds(8)

  def resource[F[_]: Async](config: JavaDiscordOAuthClient.Config): Resource[F, JavaDiscordOAuthClient[F]] = Resource
    .fromAutoCloseable(
      Async[F].blocking(HttpClient.newBuilder().connectTimeout(ConnectTimeout).build())
    ).map(new JavaDiscordOAuthClient[F](config, _))
