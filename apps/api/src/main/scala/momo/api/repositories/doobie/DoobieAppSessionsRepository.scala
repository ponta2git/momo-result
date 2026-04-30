package momo.api.repositories.doobie

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import momo.api.repositories.AppSession
import momo.api.repositories.AppSessionsRepository

import java.time.Instant

final class DoobieAppSessionsRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends AppSessionsRepository[F]:

  override def find(id: String): F[Option[AppSession]] =
    sql"""
      SELECT id, member_id, csrf_secret, created_at, last_seen_at, expires_at
      FROM app_sessions
      WHERE id = $id
    """.query[AppSession].option.transact(xa)

  override def upsert(session: AppSession): F[Unit] =
    sql"""
      INSERT INTO app_sessions
        (id, member_id, csrf_secret, created_at, last_seen_at, expires_at)
      VALUES
        (${session.id}, ${session.memberId}, ${session.csrfSecret},
         ${session.createdAt}, ${session.lastSeenAt}, ${session.expiresAt})
      ON CONFLICT (id) DO UPDATE SET
        member_id    = EXCLUDED.member_id,
        csrf_secret  = EXCLUDED.csrf_secret,
        last_seen_at = EXCLUDED.last_seen_at,
        expires_at   = EXCLUDED.expires_at
    """.update.run.void.transact(xa)

  override def delete(id: String): F[Unit] =
    sql"DELETE FROM app_sessions WHERE id = $id".update.run.void.transact(xa)

  override def touchLastSeen(id: String, lastSeenAt: Instant): F[Unit] =
    sql"UPDATE app_sessions SET last_seen_at = $lastSeenAt WHERE id = $id"
      .update
      .run
      .void
      .transact(xa)
