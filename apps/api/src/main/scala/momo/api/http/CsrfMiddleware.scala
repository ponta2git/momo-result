package momo.api.http

import cats.Applicative

import momo.api.config.AppEnv
import momo.api.errors.AppError

object CsrfMiddleware:
  val HeaderName = "X-CSRF-Token"
  val DevToken = "dev"

  def validate[F[_]: Applicative](
      appEnv: AppEnv,
      token: Option[String],
  ): F[Either[AppError, Unit]] =
    val result = appEnv match
      case AppEnv.Dev | AppEnv.Test if token.contains(DevToken) => Right(())
      case AppEnv.Dev | AppEnv.Test =>
        Left(AppError.Forbidden("Development CSRF token is required. Use X-CSRF-Token: dev."))
      case AppEnv.Prod =>
        Left(AppError.Forbidden("CSRF validation is not configured for production yet."))
    Applicative[F].pure(result)
