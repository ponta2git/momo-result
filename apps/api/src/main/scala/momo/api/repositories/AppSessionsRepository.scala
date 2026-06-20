package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.ids.{AccountId, MemberId}

/**
 * Discord OAuth session row stored in `app_sessions`.
 *
 * `idHash` and `csrfSecretHash` are SHA-256/Base64URL digests of the raw cookie tokens. The raw
 * values are only carried in the HttpOnly session cookie and must never be logged.
 */
final case class AppSession(
    idHash: String,
    accountId: AccountId,
    playerMemberId: Option[MemberId],
    csrfSecretHash: String,
    createdAt: Instant,
    lastSeenAt: Instant,
    expiresAt: Instant,
)

trait AppSessionsAlg[F0[_]]:
  def find(idHash: String): F0[Option[AppSession]]
  def upsert(session: AppSession): F0[Unit]
  def delete(idHash: String): F0[Unit]
  def deleteByAccount(accountId: AccountId): F0[Int]
  def renew(idHash: String, lastSeenAt: Instant, expiresAt: Instant): F0[Unit]
  def deleteExpired(now: Instant): F0[Int]

/**
 * Skeleton repository for the Discord OAuth session aggregate. The OAuth flow that consumes it
 * lands in a later phase. For MVP, only `find` and `upsert` are needed by tests; lifecycle (revoke,
 * prune) follows OAuth.
 */
trait AppSessionsRepository[F[_]]:
  def find(idHash: String): F[Option[AppSession]]
  def upsert(session: AppSession): F[Unit]
  def delete(idHash: String): F[Unit]
  def deleteByAccount(accountId: AccountId): F[Int]
  def renew(idHash: String, lastSeenAt: Instant, expiresAt: Instant): F[Unit]
  def deleteExpired(now: Instant): F[Int]

object AppSessionsRepository:
  def fromAlg[F0[_], F[_]](alg: AppSessionsAlg[F0], liftK: F0 ~> F): AppSessionsRepository[F] =
    new AppSessionsRepository[F]:
      def find(idHash: String): F[Option[AppSession]] = liftK(alg.find(idHash))
      def upsert(session: AppSession): F[Unit] = liftK(alg.upsert(session))
      def delete(idHash: String): F[Unit] = liftK(alg.delete(idHash))
      def deleteByAccount(accountId: AccountId): F[Int] = liftK(alg.deleteByAccount(accountId))
      def renew(idHash: String, lastSeenAt: Instant, expiresAt: Instant): F[Unit] =
        liftK(alg.renew(idHash, lastSeenAt, expiresAt))
      def deleteExpired(now: Instant): F[Int] = liftK(alg.deleteExpired(now))

  def liftIdentity[F[_]](alg: AppSessionsAlg[F]): AppSessionsRepository[F] =
    new AppSessionsRepository[F]:
      export alg.*
end AppSessionsRepository
