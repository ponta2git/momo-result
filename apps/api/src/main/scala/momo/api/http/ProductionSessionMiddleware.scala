package momo.api.http

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, HttpApp, MediaType, Request, Response, Status}
import org.typelevel.ci.CIString

import momo.api.auth.{CsrfTokenService, SessionService}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.domain.ids.*
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

private[http] final class ProductionSessionMiddleware[F[_]: Async](
    config: AppConfig,
    sessions: SessionService[F],
    csrf: CsrfTokenService,
):
  private val devUserHeader = CIString("X-Dev-User")
  private val csrfHeader = CIString(CsrfMiddleware.HeaderName)

  def apply(app: HttpApp[F]): HttpApp[F] = config.appEnv match
    case AppEnv.Dev | AppEnv.Test => Kleisli { request =>
        if isPublic(request, allowDetailedHealth = true) || request.headers.get(devUserHeader)
            .nonEmpty
        then app.run(request)
        else withSession(request, app)
      }
    case AppEnv.Prod => Kleisli { request =>
        if isPublic(request, allowDetailedHealth = false) then app.run(request)
        else withSession(request.removeHeader(devUserHeader), app)
      }

  private def withInternalAuth(request: Request[F], accountId: String): Request[F] = request
    .putHeaders(Header.Raw(devUserHeader, accountId))

  // Dev/Test endpoints still validate CSRF through the legacy header contract. After a session
  // token has been verified here, normalize the internal request to that contract.
  private def withVerifiedCsrf(request: Request[F]): Request[F] = request
    .putHeaders(Header.Raw(csrfHeader, CsrfMiddleware.DevToken))

  private def withSession(request: Request[F], app: HttpApp[F]): F[Response[F]] =
    val sessionId = request.cookies.find(_.name == config.auth.sessionCookieName).map(_.content)
    sessions.authenticate(sessionId).flatMap {
      case Left(error) => problem(error)
      case Right(authenticated) if isMutating(request.method) =>
        val token = request.headers.get(csrfHeader).map(_.head.value)
        csrf.verify(authenticated.session, token) match
          case Left(error) => problem(error)
          case Right(_) => app.run(withVerifiedCsrf(
              withInternalAuth(request, authenticated.account.accountId.value)
            ))
      case Right(authenticated) => app
          .run(withInternalAuth(request, authenticated.account.accountId.value))
    }

  private def isMutating(method: org.http4s.Method): Boolean = Set("POST", "PUT", "PATCH", "DELETE")
    .contains(method.name)

  private def isPublic(request: Request[F], allowDetailedHealth: Boolean): Boolean =
    val path = request.uri.path.renderString
    path == "/healthz" || (allowDetailedHealth && path == "/healthz/details")

  private def problem(error: AppError): F[Response[F]] =
    val (status, body) = ProblemDetails.from(error)
    Response[F](Status.fromInt(status.code).getOrElse(Status.InternalServerError))
      .withEntity(body.asJson).putHeaders(`Content-Type`(MediaType.application.json)).pure[F]
