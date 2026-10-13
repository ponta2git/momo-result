package momo.api.repositories

import java.time.Instant

/** Session creation and account disabling/revocation share one atomic boundary. */
trait LoginSessionCreationRepository[F[_]]:
  def createIfAccountCurrent(session: AppSession, expectedAccountUpdatedAt: Instant): F[Boolean]
