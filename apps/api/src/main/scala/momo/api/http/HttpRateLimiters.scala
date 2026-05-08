package momo.api.http

import momo.api.auth.LoginRateLimiter

final case class HttpRateLimiters[F[_]](
    upload: LoginRateLimiter[F],
    matchExport: LoginRateLimiter[F],
)
