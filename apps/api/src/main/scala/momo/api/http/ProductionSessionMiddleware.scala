package momo.api.http

import cats.data.Kleisli
import cats.effect.Async
import cats.syntax.all.*
import io.circe.syntax.*
import momo.api.auth.{CsrfTokenService, SessionService}
import momo.api.config.{AppConfig, AppEnv}
import momo.api.domain.ids.*
import momo.api.errors.AppError
import org.http4s.{Header, HttpApp, MediaType, Request, Response, Status}
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.typelevel.ci.CIString

private[http] final class ProductionSessionMiddleware[F[_]: Async](
    config: AppConfig,
    sessions: SessionService[F],
    csrf: CsrfTokenService,
):
  private val devUserHeader = CIString("X-Dev-User")
  private val csrfHeader = CIString(CsrfMiddleware.HeaderName)

  def apply(app: HttpApp[F]): HttpApp[F] = config.appEnv match
    case AppEnv.Dev | AppEnv.Test => app
    case AppEnv.Prod => Kleisli { request =>
        if isPublic(request) then app.run(request)
        else
          val sanitized = request.removeHeader(devUserHeader)
          val sessionId = sanitized.cookies.find(_.name == config.auth.sessionCookieName)
            .map(_.content)
          sessions.authenticate(sessionId).flatMap {
            case Left(error) => problem(error)
            case Right(authenticated) if isMutating(sanitized.method) =>
              val token = sanitized.headers.get(csrfHeader).map(_.head.value)
              csrf.verify(authenticated.session, token) match
                case Left(error) => problem(error)
                case Right(_) => app
                    .run(withInternalAuth(sanitized, authenticated.member.memberId.value))
            case Right(authenticated) => app
                .run(withInternalAuth(sanitized, authenticated.member.memberId.value))
          }
      }

  private def withInternalAuth(request: Request[F], memberId: String): Request[F] = request
    .putHeaders(Header.Raw(devUserHeader, memberId))

  private def isMutating(method: org.http4s.Method): Boolean = Set("POST", "PUT", "PATCH", "DELETE")
    .contains(method.name)

  private def isPublic(request: Request[F]): Boolean =
    val path = request.uri.path.renderString
    path == "/healthz" || path == "/openapi.yaml"

  private def problem(error: AppError): F[Response[F]] =
    val (status, body) = ProblemDetails.from(error)
    Response[F](Status.fromInt(status.code).getOrElse(Status.InternalServerError))
      .withEntity(body.asJson).putHeaders(`Content-Type`(MediaType.application.json)).pure[F]
