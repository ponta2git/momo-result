package momo.api.auth

import java.time.Instant

import cats.effect.Sync
import cats.effect.std.SecureRandom
import cats.syntax.all.*

import momo.api.config.AuthConfig
import momo.api.domain.LoginAccount
import momo.api.errors.AppError
import momo.api.repositories.{AppSession, AppSessionsRepository, LoginAccountsRepository}

final case class CreatedSession(cookieValue: String)

final case class AuthenticatedSession(
    account: AuthenticatedAccount,
    session: AppSession,
    csrfToken: String,
)

final class SessionService[F[_]: Sync: SecureRandom](
    sessions: AppSessionsRepository[F],
    accounts: LoginAccountsRepository[F],
    config: AuthConfig,
    now: F[Instant],
):
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
    sessionCookie.flatMap(SessionCookieCodec.decode) match
      case None => Sync[F].pure(Left(AppError.Unauthorized()))
      case Some(tokens) =>
        for
          current <- now
          idHash <- SessionTokenHash.sha256[F](tokens.sessionToken)
          csrfMatches <- SessionTokenHash.matches[F](tokens.csrfToken)
          maybeSession <- sessions.find(idHash)
          result <- maybeSession match
            case None => Sync[F].pure(Left(AppError.Unauthorized()))
            case Some(session) if !session.expiresAt.isAfter(current) =>
              sessions.delete(session.idHash)
                .as(Left(AppError.Unauthorized("Session has expired.")))
            case Some(session) if !csrfMatches(session.csrfSecretHash) =>
              Sync[F].pure(Left(AppError.Unauthorized()))
            case Some(session) => accounts.find(session.accountId).flatMap {
                case None => sessions.delete(session.idHash).as(Left(AppError.Unauthorized()))
                case Some(account) if !account.loginEnabled =>
                  sessions.delete(session.idHash)
                    .as(Left(AppError.Forbidden("This account is not allowed to log in.")))
                case Some(account) =>
                  val renewed = session.copy(
                    lastSeenAt = current,
                    expiresAt = current.plusSeconds(config.sessionTtl.toSeconds),
                  )
                  val accountAuth = AuthenticatedAccount(
                    account.id,
                    account.displayName,
                    account.isAdmin,
                    account.playerMemberId,
                  )
                  if shouldRenew(session, current) then
                    sessions.renew(renewed.idHash, renewed.lastSeenAt, renewed.expiresAt)
                      .as(Right(AuthenticatedSession(accountAuth, renewed, tokens.csrfToken)))
                  else
                    Sync[F]
                      .pure(Right(AuthenticatedSession(accountAuth, session, tokens.csrfToken)))
              }
        yield result

  def delete(idHash: String): F[Unit] = sessions.delete(idHash)

  private def shouldRenew(session: AppSession, current: Instant): Boolean = current
    .isAfter(session.expiresAt.minusSeconds(config.sessionTtl.toSeconds / 2L))
