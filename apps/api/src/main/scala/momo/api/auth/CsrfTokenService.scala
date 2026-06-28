package momo.api.auth

import momo.api.errors.AppError
import momo.api.repositories.AppSession

final class CsrfTokenService:
  def issue(authenticated: AuthenticatedSession): String = authenticated.csrfToken

  def verify(session: AppSession, token: Option[String]): Either[AppError, Unit] = token match
    case Some(value) if SessionTokenHash.matchesUnsafe(value, session.csrfSecretHash) => Right(())
    case _ => Left(AppError.Forbidden("A valid CSRF token is required."))
