package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.AccountId
import momo.api.repositories.{AppSession, AppSessionsRepository}

final class InMemoryAppSessionsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, AppSession]])
    extends AppSessionsRepository[F]:
  override def find(idHash: String): F[Option[AppSession]] = ref.get.map(_.get(idHash))

  override def upsert(session: AppSession): F[Unit] = ref.update(_.updated(session.idHash, session))

  override def delete(idHash: String): F[Unit] = ref.update(_ - idHash)

  override def deleteByAccount(accountId: AccountId): F[Int] = ref.modify { sessions =>
    val retained = sessions.filter { case (_, session) => session.accountId != accountId }
    (retained, sessions.size - retained.size)
  }

  override def renew(idHash: String, lastSeenAt: Instant, expiresAt: Instant): F[Unit] = ref
    .update(sessions =>
      sessions.updatedWith(idHash)(_.map(_.copy(lastSeenAt = lastSeenAt, expiresAt = expiresAt)))
    )

  override def deleteExpired(now: Instant): F[Int] = ref.modify { sessions =>
    val retained = sessions.filter { case (_, session) => !session.expiresAt.isBefore(now) }
    (retained, sessions.size - retained.size)
  }

object InMemoryAppSessionsRepository:
  def create[F[_]: Sync]: F[InMemoryAppSessionsRepository[F]] = Ref
    .of[F, Map[String, AppSession]](Map.empty).map(InMemoryAppSessionsRepository(_))
