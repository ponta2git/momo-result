package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

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

trait AppSessionsAlg[F0[_]]:
  def find(id: String): F0[Option[AppSession]]
  def upsert(session: AppSession): F0[Unit]
  def delete(id: String): F0[Unit]
  def touchLastSeen(id: String, lastSeenAt: Instant): F0[Unit]

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

object AppSessionsRepository:
  def fromConnectionIO[F[_]](
      alg: AppSessionsAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): AppSessionsRepository[F] = new AppSessionsRepository[F]:
    def find(id: String): F[Option[AppSession]] = transactK(alg.find(id))
    def upsert(session: AppSession): F[Unit] = transactK(alg.upsert(session))
    def delete(id: String): F[Unit] = transactK(alg.delete(id))
    def touchLastSeen(id: String, lastSeenAt: Instant): F[Unit] =
      transactK(alg.touchLastSeen(id, lastSeenAt))

  def liftIdentity[F[_]](alg: AppSessionsAlg[F]): AppSessionsRepository[F] =
    new AppSessionsRepository[F]:
      def find(id: String): F[Option[AppSession]] = alg.find(id)
      def upsert(session: AppSession): F[Unit] = alg.upsert(session)
      def delete(id: String): F[Unit] = alg.delete(id)
      def touchLastSeen(id: String, lastSeenAt: Instant): F[Unit] = alg
        .touchLastSeen(id, lastSeenAt)
end AppSessionsRepository
