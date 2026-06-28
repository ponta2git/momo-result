package momo.api.auth

import momo.api.errors.AppError

trait RateLimiter[F[_]]:
  def allow(key: String): F[Boolean]

trait OAuthProviderBackoff[F[_]]:
  def isBlocked: F[Boolean]
  def recordFailure(error: AppError): F[Boolean]
  def recordSuccess: F[Unit]
