package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.repositories.{AppSession, AppSessionsRepository}

final class InMemoryAppSessionsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, AppSession]])
    extends AppSessionsRepository[F]:
  override def find(id: String): F[Option[AppSession]] = ref.get.map(_.get(id))

  override def upsert(session: AppSession): F[Unit] = ref.update(_.updated(session.id, session))

  override def delete(id: String): F[Unit] = ref.update(_ - id)

  override def touchLastSeen(id: String, lastSeenAt: Instant): F[Unit] = ref
    .update(sessions => sessions.updatedWith(id)(_.map(_.copy(lastSeenAt = lastSeenAt))))

object InMemoryAppSessionsRepository:
  def create[F[_]: Sync]: F[InMemoryAppSessionsRepository[F]] = Ref
    .of[F, Map[String, AppSession]](Map.empty).map(InMemoryAppSessionsRepository(_))
