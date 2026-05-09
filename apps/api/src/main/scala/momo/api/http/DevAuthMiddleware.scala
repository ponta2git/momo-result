package momo.api.http

import cats.effect.Sync

import momo.api.auth.{AuthenticatedAccount, MemberRoster}
import momo.api.config.AppEnv
import momo.api.errors.AppError

object DevAuthMiddleware:
  def authenticate[F[_]: Sync](
      appEnv: AppEnv,
      roster: MemberRoster,
      headerValue: String,
  ): F[Either[AppError, AuthenticatedAccount]] = appEnv match
    case AppEnv.Prod => Sync[F]
        .pure(Left(AppError.Forbidden("Development authentication is disabled in prod.")))
    case AppEnv.Dev | AppEnv.Test => Sync[F].pure(
        roster.find(headerValue)
          .toRight(AppError.Forbidden("X-Dev-User is not one of the allowed accounts."))
      )
