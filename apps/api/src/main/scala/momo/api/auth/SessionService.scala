package momo.api.auth

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.data.EitherT
import cats.effect.Sync
import cats.effect.std.SecureRandom
import cats.syntax.all.*

import momo.api.domain.LoginAccount
import momo.api.errors.AppError
import momo.api.repositories.{
  AppSession,
  AppSessionsRepository,
  LoginAccountsRepository,
  SessionAccountLookup
}

final case class CreatedSession(cookieValue: String)

final case class AuthenticatedSession(
    account: AuthenticatedAccount,
    session: AppSession,
    csrfToken: String,
)

final class SessionService[F[_]: Sync: SecureRandom](
    sessions: AppSessionsRepository[F],
    sessionTtl: FiniteDuration,
    now: F[Instant],
    sessionAccounts: SessionAccountLookup[F],
):
  def this(
      sessions: AppSessionsRepository[F],
      accounts: LoginAccountsRepository[F],
      sessionTtl: FiniteDuration,
      now: F[Instant],
  ) = this(sessions, sessionTtl, now, SessionAccountLookup.fromRepositories(sessions, accounts))

  def create(account: LoginAccount): F[CreatedSession] =
    for
      current <- now
      id <- SecureTokenGenerator.token[F](32)
      csrf <- SecureTokenGenerator.token[F](32)
      idHash <- SessionTokenHash.sha256[F](id)
      csrfHash <- SessionTokenHash.sha256[F](csrf)
      session = AppSession(
        idHash = idHash,
        accountId = account.id,
        playerMemberId = account.playerMemberId,
        csrfSecretHash = csrfHash,
        createdAt = current,
        lastSeenAt = current,
        expiresAt = current.plusSeconds(sessionTtl.toSeconds),
      )
      _ <- sessions.upsert(session)
    yield CreatedSession(SessionCookieCodec.encode(SessionCookieTokens(id, csrf)))

  def authenticate(sessionCookie: Option[String]): F[Either[AppError, AuthenticatedSession]] =
    (for
      tokens <- EitherT.fromOption[F](
        sessionCookie.flatMap(SessionCookieCodec.decode),
        AppError.Unauthorized(),
      )
      current <- EitherT.liftF(now)
      idHash <- EitherT.liftF(SessionTokenHash.sha256[F](tokens.sessionToken))
      sessionAccount <- EitherT.fromOptionF(sessionAccounts.find(idHash), AppError.Unauthorized())
      session = sessionAccount.session
      csrfMatches <- EitherT.liftF(
        SessionTokenHash.matches[F](tokens.csrfToken, session.csrfSecretHash)
      )
      _ <- EitherT(rejectExpired(session, current))
      _ <- EitherT.cond[F](csrfMatches, (), AppError.Unauthorized())
      account <- EitherT(requireEnabledAccount(session, sessionAccount.account))
      authenticated <-
        EitherT.liftF(completeAuthentication(session, account, tokens.csrfToken, current))
    yield authenticated).value

  def delete(idHash: String): F[Unit] = sessions.delete(idHash)

  private def rejectExpired(session: AppSession, current: Instant): F[Either[AppError, Unit]] =
    if session.expiresAt.isAfter(current) then ().asRight[AppError].pure[F]
    else sessions.delete(session.idHash).as(AppError.Unauthorized("Session has expired.").asLeft)

  private def requireEnabledAccount(
      session: AppSession,
      account: LoginAccount,
  ): F[Either[AppError, LoginAccount]] =
    if account.loginEnabled then account.asRight[AppError].pure[F]
    else
      sessions.delete(session.idHash)
        .as(AppError.Forbidden("This account is not allowed to log in.").asLeft)

  private def completeAuthentication(
      session: AppSession,
      account: LoginAccount,
      csrfToken: String,
      current: Instant,
  ): F[AuthenticatedSession] =
    val accountAuth = AuthenticatedAccount.from(account)
    if shouldRenew(session, current) then
      val renewed = session.copy(
        lastSeenAt = current,
        expiresAt = current.plusSeconds(sessionTtl.toSeconds),
      )
      sessions.renew(renewed.idHash, renewed.lastSeenAt, renewed.expiresAt)
        .as(AuthenticatedSession(accountAuth, renewed, csrfToken))
    else AuthenticatedSession(accountAuth, session, csrfToken).pure[F]

  private def shouldRenew(session: AppSession, current: Instant): Boolean = current
    .isAfter(session.expiresAt.minusSeconds(sessionTtl.toSeconds / 2L))
