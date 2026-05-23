package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory

import momo.api.auth.RateLimiter
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

object ReadRateLimit:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.ReadRateLimit")

  def enforce[F[_]: Async, A](rateLimiter: RateLimiter[F], accountId: String, route: String)(
      next: => F[Either[ProblemDetails.ProblemResponse, A]]
  ): F[Either[ProblemDetails.ProblemResponse, A]] = rateLimiter.allow(s"read-api:$accountId")
    .flatMap {
      case true => next
      case false => rateLimited[F, A](accountId, route)
    }

  private def rateLimited[F[_]: Async, A](
      accountId: String,
      route: String,
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F]
    .delay(logger.warn(s"read_api_rate_limited route=$route accountId=$accountId")) *>
    Async[F].pure(Left(
      ProblemDetails.from(AppError.TooManyRequests("Too many read requests. Try again later."))
    ))
