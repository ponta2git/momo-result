package momo.api.repositories

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.LoginAccount

final case class SessionAccount(session: AppSession, account: LoginAccount)

trait SessionAccountLookup[F[_]]:
  def find(idHash: String): F[Option[SessionAccount]]

object SessionAccountLookup:
  def fromRepositories[F[_]: Monad](
      sessions: AppSessionsRepository[F],
      accounts: LoginAccountsRepository[F],
  ): SessionAccountLookup[F] = new SessionAccountLookup[F]:
    override def find(idHash: String): F[Option[SessionAccount]] = sessions.find(idHash).flatMap {
      case None => none[SessionAccount].pure[F]
      case Some(session) => accounts.find(session.accountId).map(_.map(SessionAccount(session, _)))
    }
