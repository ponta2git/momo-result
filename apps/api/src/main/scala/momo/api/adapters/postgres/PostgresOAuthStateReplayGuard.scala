package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.auth.OAuthStateReplayGuard

/** Commits consumption before the caller can start the OAuth provider request. */
final class PostgresOAuthStateReplayGuard[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OAuthStateReplayGuard[F]:
  override def consume(stateHash: String, expiresAt: Instant): F[Boolean] = sql"""
    WITH consumed AS (
      INSERT INTO oauth_state_consumptions (state_hash, expires_at)
      SELECT $stateHash, $expiresAt
      WHERE $expiresAt > clock_timestamp()
      ON CONFLICT (state_hash) DO NOTHING
      RETURNING expires_at
    )
    SELECT EXISTS (SELECT 1 FROM consumed WHERE expires_at > clock_timestamp())
  """.query[Boolean].unique.transact(transactor)

  // Use the same DB clock as consumption. The post-insert expiry check also rejects a
  // stale waiter if cleanup deletes its conflicting row while the INSERT is blocked.
  def deleteExpired: F[Int] = sql"""
    DELETE FROM oauth_state_consumptions WHERE expires_at <= clock_timestamp()
  """.update.run.transact(transactor)
