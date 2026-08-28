package momo.api.auth

import java.time.Instant

import cats.data.EitherT
import cats.effect.Sync
import cats.effect.std.SecureRandom
import cats.syntax.all.*

import momo.api.config.AuthConfig
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
    config: AuthConfig,
    now: F[Instant],
    sessionAccounts: SessionAccountLookup[F],
):
  def this(
      sessions: AppSessionsRepository[F],
      accounts: LoginAccountsRepository[F],
      config: AuthConfig,
      now: F[Instant],
  ) = this(sessions, config, now, SessionAccountLookup.fromRepositories(sessions, accounts))

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
        expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
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
      account <- EitherT(loadEnabledAccount(session, sessionAccount.account.some))
      authenticated <-
        EitherT.liftF(completeAuthentication(session, account, tokens.csrfToken, current))
    yield authenticated).value

  def delete(idHash: String): F[Unit] = sessions.delete(idHash)

  private def rejectExpired(session: AppSession, current: Instant): F[Either[AppError, Unit]] =
    if session.expiresAt.isAfter(current) then ().asRight[AppError].pure[F]
    else sessions.delete(session.idHash).as(AppError.Unauthorized("Session has expired.").asLeft)

  private def loadEnabledAccount(
      session: AppSession,
      loadedAccount: Option[LoginAccount],
  ): F[Either[AppError, LoginAccount]] = loadedAccount match
    case None => sessions.delete(session.idHash).as(AppError.Unauthorized().asLeft)
    case Some(account) if !account.loginEnabled =>
      sessions.delete(session.idHash)
        .as(AppError.Forbidden("This account is not allowed to log in.").asLeft)
    case Some(account) => account.asRight[AppError].pure[F]

  private def completeAuthentication(
      session: AppSession,
      account: LoginAccount,
      csrfToken: String,
      current: Instant,
  ): F[AuthenticatedSession] =
    val accountAuth = authenticatedAccount(account)
    if shouldRenew(session, current) then
      val renewed = session.copy(
        lastSeenAt = current,
        expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
      )
      sessions.renew(renewed.idHash, renewed.lastSeenAt, renewed.expiresAt)
        .as(AuthenticatedSession(accountAuth, renewed, csrfToken))
    else AuthenticatedSession(accountAuth, session, csrfToken).pure[F]

  private def authenticatedAccount(account: LoginAccount): AuthenticatedAccount =
    AuthenticatedAccount(
      account.id,
      account.displayName,
      account.isAdmin,
      account.playerMemberId,
    )

  private def shouldRenew(session: AppSession, current: Instant): Boolean = current
    .isAfter(session.expiresAt.minusSeconds(config.sessionTtl.toSeconds / 2L))
