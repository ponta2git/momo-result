package momo.api.repositories

import java.time.Instant

/**
 * Session creation and account disabling/revocation share one atomic boundary. The expected
 * timestamp comes from a persisted account lookup, including the store's timestamp precision.
 */
trait LoginSessionCreationRepository[F[_]]:
  def createIfAccountCurrent(session: AppSession, expectedAccountUpdatedAt: Instant): F[Boolean]
