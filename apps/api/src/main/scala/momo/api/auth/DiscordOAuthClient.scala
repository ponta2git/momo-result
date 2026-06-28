package momo.api.auth

import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.net.{URI, URLEncoder}
import java.nio.charset.StandardCharsets

import cats.effect.{Async, Resource, Sync}
import cats.syntax.all.*
import io.circe.Decoder
import io.circe.parser.decode
import org.slf4j.LoggerFactory

import momo.api.config.AuthConfig
import momo.api.errors.AppError
import momo.api.logging.SafeLog

final case class DiscordUser(id: String)

trait DiscordOAuthClient[F[_]]:
  def authorizationUrl(state: String, prompt: Option[String]): F[String]
  def fetchUser(code: String): F[Either[AppError, DiscordUser]]

final class JavaDiscordOAuthClient[F[_]: Async](config: AuthConfig, client: HttpClient)
    extends DiscordOAuthClient[F]:
  import JavaDiscordOAuthClient.*

  private val authorizeUrl = "https://discord.com/oauth2/authorize"
  private val tokenUrl = "https://discord.com/api/oauth2/token"
  private val userUrl = "https://discord.com/api/users/@me"
  private val logger = LoggerFactory.getLogger("momo.api.auth.JavaDiscordOAuthClient")

  override def authorizationUrl(state: String, prompt: Option[String]): F[String] = Async[F].delay {
    val params = Map(
      "client_id" -> config.discordClientId.getOrElse(""),
      "redirect_uri" -> config.discordRedirectUri.getOrElse(""),
      "response_type" -> "code",
      "scope" -> config.discordScope,
      "state" -> state,
    ) ++ prompt.map("prompt" -> _)
    s"$authorizeUrl?${formEncode(params)}"
  }

  override def fetchUser(code: String): F[Either[AppError, DiscordUser]] = exchangeToken(code)
    .flatMap {
      case Left(error) => Async[F].pure(Left(error))
      case Right(accessToken) => fetchUserInfo(accessToken)
    }

  private def exchangeToken(code: String): F[Either[AppError, String]] = Async[F].blocking {
    Either.catchNonFatal {
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
        Left(statusError(
          operation = "token_exchange",
          status = response.statusCode(),
          forbiddenDetail = "Discord OAuth token exchange failed.",
        ))
      else
        decode[TokenResponse](response.body())
          .leftMap(_ => parseError("token_exchange", "Discord OAuth token response is invalid."))
          .map(_.accessToken)
    }.leftMap(error => transportError("token_exchange", error)).flatten
  }

  private def fetchUserInfo(accessToken: String): F[Either[AppError, DiscordUser]] = Async[F]
    .blocking {
      Either.catchNonFatal {
        val request = HttpRequest.newBuilder(URI.create(userUrl))
          .header("Authorization", s"Bearer $accessToken").timeout(RequestTimeout).GET().build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        if response.statusCode() / 100 != 2 then
          Left(statusError(
            operation = "user_lookup",
            status = response.statusCode(),
            forbiddenDetail = "Discord user lookup failed.",
          ))
        else
          decode[DiscordUserResponse](response.body())
            .leftMap(_ => parseError("user_lookup", "Discord user response is invalid."))
            .map(user => DiscordUser(user.id))
      }.leftMap(error => transportError("user_lookup", error)).flatten
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
  private val ConnectTimeout = java.time.Duration.ofSeconds(5)
  private val RequestTimeout = java.time.Duration.ofSeconds(8)

  def resource[F[_]: Async](config: AuthConfig): Resource[F, JavaDiscordOAuthClient[F]] = Resource
    .fromAutoCloseable(
      Sync[F].delay(HttpClient.newBuilder().connectTimeout(ConnectTimeout).build())
    ).map(new JavaDiscordOAuthClient[F](config, _))
