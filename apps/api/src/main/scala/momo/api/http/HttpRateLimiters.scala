package momo.api.http

import momo.api.auth.RateLimiter

final case class HttpRateLimiters[F[_]](upload: RateLimiter[F], matchExport: RateLimiter[F])
