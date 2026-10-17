package momo.api.http

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import cats.data.Kleisli
import cats.effect.Async
import cats.effect.syntax.all.*
import cats.syntax.all.*
import io.circe.Json
import io.circe.parser.parse
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, HttpApp, MediaType, Method, Request, Response, Status}
import org.typelevel.ci.CIString

import momo.api.maintenance.MaintenanceDrain

/** Gate before session authorization: GETs can also expire sessions or request analysis work. */
private[api] object MaintenanceHttpApp:
  val Path = "/internal/maintenance/drain"
  private val Authorization = CIString("Authorization")
  private val MaximumBodyBytes = 512L

  def apply[F[_]: Async](
      app: HttpApp[F],
      maintenance: MaintenanceDrain[F],
      operationsToken: Option[String],
  ): HttpApp[F] = Kleisli { request =>
    val path = request.uri.path.renderString
    if path == Path then control(request, maintenance, operationsToken)
    else if path == "/healthz" then
      maintenance.admissionOpen.flatMap { open =>
        if open then runAdmitted(app, request, maintenance)
        else
          Async[F].pure(response(Status.Ok, Json.obj("status" -> Json.fromString("maintenance"))))
      }
    else runAdmitted(app, request, maintenance)
  }

  private def runAdmitted[F[_]: Async](
      app: HttpApp[F],
      request: Request[F],
      maintenance: MaintenanceDrain[F],
  ): F[Response[F]] = Async[F].uncancelable { poll =>
    maintenance.acquireRequest(isOcrContinuation(request)).flatMap {
      case None => Async[F].pure(error(Status.ServiceUnavailable, "maintenance"))
      case Some(release) => poll(app.run(request)).onCancel(release).attempt.flatMap {
          case Left(failure) => release *> Async[F].raiseError(failure)
          // Stream finalization includes lazy DB/storage reads and client-disconnect cleanup.
          case Right(result) =>
            Async[F].pure(result.withBodyStream(result.body.onFinalize(release)))
        }
    }
  }

  private def isOcrContinuation[F[_]](request: Request[F]): Boolean =
    val path = request.uri.path.renderString
    (request.method === Method.PUT && path.matches("/api/ocr-submissions/[^/]+")) ||
    (request.method === Method.POST &&
      Set("/api/uploads/images", "/api/ocr-jobs").contains(path)) ||
    (request.method === Method.GET &&
      (path.matches("/api/ocr-(submissions|jobs|drafts)/[^/]+") || path == "/api/ocr-drafts")) ||
    (request.method === Method.DELETE && path.matches("/api/ocr-jobs/[^/]+"))

  private def control[F[_]: Async](
      request: Request[F],
      maintenance: MaintenanceDrain[F],
      operationsToken: Option[String],
  ): F[Response[F]] =
    if !authorized(request, operationsToken) then
      Async[F].pure(error(Status.Unauthorized, "unauthorized"))
    else if request.method === Method.GET then maintenance.snapshot.map(response(Status.Ok, _))
    else if request.method =!= Method.POST then
      Async[F].pure(error(Status.MethodNotAllowed, "method_not_allowed"))
    else if !request.contentType.exists(_.mediaType === MediaType.application.json) then
      Async[F].pure(error(Status.BadRequest, "invalid_content_type"))
    else if request.contentLength.exists(_ > MaximumBodyBytes) then
      Async[F].pure(error(Status.PayloadTooLarge, "payload_too_large"))
    else
      request.body.take(MaximumBodyBytes + 1).compile.toVector.flatMap { bytes =>
        if bytes.size > MaximumBodyBytes then
          Async[F].pure(error(Status.PayloadTooLarge, "payload_too_large"))
        else
          parse(new String(bytes.toArray, StandardCharsets.UTF_8)).toOption
            .flatMap(MaintenanceDrain.parse) match
            case None => Async[F].pure(error(Status.BadRequest, "invalid_input"))
            case Some(input) => maintenance.request(input).flatMap {
                case false => Async[F].pure(error(Status.Conflict, "cutover_conflict"))
                case true => maintenance.snapshot.map(response(Status.Accepted, _))
              }
      }

  private def authorized[F[_]](request: Request[F], token: Option[String]): Boolean =
    val headers = request.headers.headers.filter(_.name === Authorization)
    token.exists { expected =>
      headers match
        case header :: Nil if header.value.startsWith("Bearer ") =>
          val digest = MessageDigest.getInstance("SHA-256")
          MessageDigest.isEqual(
            digest.digest(expected.getBytes(StandardCharsets.UTF_8)),
            digest.digest(header.value.substring(7).getBytes(StandardCharsets.UTF_8)),
          )
        case _ => false
    }

  private def error[F[_]](status: Status, code: String): Response[F] =
    response(status, Json.obj("error" -> Json.fromString(code)))

  private def response[F[_]](status: Status, payload: Json): Response[F] =
    Response[F](status).withEntity(payload.noSpaces).putHeaders(
      `Content-Type`(MediaType.application.json),
      Header.Raw(CIString("Cache-Control"), "no-store"),
    )
