package momo.api.auth

import cats.effect.Sync
import cats.syntax.all.*
import org.slf4j.LoggerFactory

import momo.api.domain.ids.{AccountId, UserId}
import momo.api.errors.AppError
import momo.api.repositories.LoginAccountsRepository

final case class OAuthLoginCompletion(accountId: AccountId, session: CreatedSession)

sealed trait OAuthLoginFailure:
  def reason: String
  def error: AppError

object OAuthLoginFailure:
  final case class ProviderError(error: AppError) extends OAuthLoginFailure:
    override val reason: String = "provider_error"

  final case class SessionRejected(error: AppError) extends OAuthLoginFailure:
    override val reason: String = "session_rejected"

  case object InvalidDiscordUserId extends OAuthLoginFailure:
    override val reason: String = "invalid_discord_user_id"
    override val error: AppError =
      AppError.Forbidden("This Discord user is not allowed to log in.")

  case object DiscordUserNotAllowed extends OAuthLoginFailure:
    override val reason: String = "discord_user_not_allowed"
    override val error: AppError =
      AppError.Forbidden("This Discord user is not allowed to log in.")

  case object LoginDisabled extends OAuthLoginFailure:
    override val reason: String = "login_disabled"
    override val error: AppError =
      AppError.Forbidden("This account is not allowed to log in.")

final class CompleteOAuthLogin[F[_]: Sync](
    oauth: DiscordOAuthClient[F],
    sessions: SessionService[F],
    accounts: LoginAccountsRepository[F],
):
  private val logger = LoggerFactory.getLogger("momo.api.auth.CompleteOAuthLogin")

  def run(code: String): F[Either[OAuthLoginFailure, OAuthLoginCompletion]] =
    fetchDiscordUser(code).flatMap {
      case Left(failure) => failure.asLeft[OAuthLoginCompletion].pure[F]
      case Right(discordUser) => completeForDiscordUser(discordUser)
    }

  private def fetchDiscordUser(code: String): F[Either[OAuthLoginFailure, DiscordUser]] =
    oauth.fetchUser(code).map(_.leftMap(OAuthLoginFailure.ProviderError.apply))

  private def completeForDiscordUser(
      discordUser: DiscordUser
  ): F[Either[OAuthLoginFailure, OAuthLoginCompletion]] =
    UserId.fromString(discordUser.id) match
      case Left(_) => OAuthLoginFailure.InvalidDiscordUserId.asLeft[OAuthLoginCompletion].pure[F]
      case Right(userId) => accounts.findByDiscordUserId(userId).flatMap {
          case None => OAuthLoginFailure.DiscordUserNotAllowed.asLeft[OAuthLoginCompletion].pure[F]
          case Some(account) if !account.loginEnabled =>
            OAuthLoginFailure.LoginDisabled.asLeft[OAuthLoginCompletion].pure[F]
          case Some(account) => sessions.create(account).flatMap {
              case Left(error) =>
                OAuthLoginFailure.SessionRejected(error).asLeft[OAuthLoginCompletion].pure[F]
              case Right(session) => Sync[F].delay(
                  logger.info(s"auth_login_completed accountId=${account.id.value}")
                ).as(OAuthLoginCompletion(account.id, session).asRight[OAuthLoginFailure])
            }
        }
