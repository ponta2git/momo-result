package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.MemberId

/**
 * Discord OAuth session row stored in `app_sessions`.
 *
 * `csrfSecret` is the per-session CSRF secret used to derive request tokens. Both columns are
 * sensitive and must never be logged.
 */
final case class AppSession(
    id: String,
    memberId: MemberId,
    csrfSecret: String,
    createdAt: Instant,
    lastSeenAt: Instant,
    expiresAt: Instant,
)

/**
 * Skeleton repository for the Discord OAuth session aggregate. The OAuth flow that consumes it
 * lands in a later phase. For MVP, only `find` and `upsert` are needed by tests; lifecycle (revoke,
 * prune) follows OAuth.
 */
trait AppSessionsRepository[F[_]]:
  def find(id: String): F[Option[AppSession]]
  def upsert(session: AppSession): F[Unit]
  def delete(id: String): F[Unit]
  def touchLastSeen(id: String, lastSeenAt: Instant): F[Unit]
