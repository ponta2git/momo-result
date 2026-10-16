package momo.api.auth

trait RateLimiter[F[_]]:
  def allow(key: String): F[Boolean]
