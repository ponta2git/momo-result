package momo.api.http

import cats.Functor
import cats.syntax.all.*

import momo.api.auth.RateLimiter
import momo.api.errors.AppError

final case class HttpRateLimiters[F[_]](
    upload: RateLimiter[F],
    matchExport: RateLimiter[F],
    matchExportAll: RateLimiter[F],
    sourceImageDownload: RateLimiter[F],
    readApi: RateLimiter[F],
    mutation: RateLimiter[F],
    ocrJobCreate: RateLimiter[F],
    ocrJobCreateGlobal: RateLimiter[F],
    mutationAttempt: RateLimiter[F],
    authSession: RateLimiter[F],
)

object HttpRateLimiters:
  def checkAttempt[F[_]: Functor](
      limiter: RateLimiter[F],
      accountId: String,
  ): F[Either[AppError, Unit]] = limiter.allow(accountId).map(allowed =>
    Either.cond(allowed, (), AppError.TooManyRequests("Too many API requests. Try again later."))
  )
