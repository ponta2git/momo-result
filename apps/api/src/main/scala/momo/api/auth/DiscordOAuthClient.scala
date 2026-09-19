package momo.api.auth

import momo.api.errors.AppError

final case class DiscordUser(id: String)

trait DiscordOAuthClient[F[_]]:
  def authorizationUrl(state: String, prompt: Option[String]): F[String]
  def fetchUser(code: String): F[Either[AppError, DiscordUser]]
