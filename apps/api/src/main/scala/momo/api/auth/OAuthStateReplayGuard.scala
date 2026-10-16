package momo.api.auth

import java.time.Instant

/** Consumes a validated state exactly once for its entire signed lifetime. */
trait OAuthStateReplayGuard[F[_]]:
  def consume(stateHash: String, expiresAt: Instant): F[Boolean]
