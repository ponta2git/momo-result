package momo.api.http

import java.util.UUID

import scala.concurrent.duration.*
import scala.util.Try

import cats.data.Kleisli
import cats.effect.{Async, Resource}
import cats.syntax.all.*
import fs2.io.net.Network
import io.circe.Json
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.headers.`Content-Type`
import org.http4s.{Header, HttpApp, MediaType, Response, Status}
import org.typelevel.ci.CIString

import momo.api.config.WorkerWakeConfig
import momo.api.usecases.queue.{WorkerWakeCursor, WorkerWakeup}

/** Mounted only on the private listener. Cursor reads/writes never acquire a DB connection. */
private[api] object WorkerWakeServer:
  val Path = "/internal/worker/wake"

  def resource[F[_]: Async: Network](config: WorkerWakeConfig, app: HttpApp[F]): Resource[F, Unit] =
    EmberServerBuilder.default[F].withHost(config.host).withPort(config.port)
      .withIdleTimeout(45.seconds).withShutdownTimeout(1.second)
      .withHttpApp(app).build.void

  def routes[F[_]: Async](config: WorkerWakeConfig, wake: WorkerWakeup[F]): HttpApp[F] =
    Kleisli { request =>
      val authorized = request.headers.get(CIString("Authorization")).exists { values =>
        values.tail.isEmpty && values.head.value.startsWith("Bearer ") &&
        config.accepts(values.head.value.drop(7))
      }
      if request.uri.path.renderString != Path then Response[F](Status.NotFound).pure[F]
      else if !authorized then Response[F](Status.Unauthorized).pure[F]
      else
        val query = request.uri.query.toVector
        def response(state: F[WorkerWakeCursor]): F[Response[F]] = state.map { cursor =>
          val body = Json.obj(
            "boot" -> Json.fromString(cursor.boot.toString),
            "cursor" -> Json.fromBigInt(BigInt(cursor.unsignedCounter)),
          )
          Response[F](Status.Ok).withEntity(body.noSpaces)
            .putHeaders(
              `Content-Type`(MediaType.application.json),
              Header.Raw(CIString("Cache-Control"), "no-store")
            )
        }
        request.method.name match
          case "GET" if query.isEmpty => response(wake.await(None))
          case "GET" =>
            val previous =
              for
                boot <- request.params.get("boot").flatMap(s => Try(UUID.fromString(s)).toOption)
                cursor <- request.params.get("cursor").flatMap(s =>
                  Try(java.lang.Long.parseUnsignedLong(s)).toOption
                )
                if query.size == 2
              yield WorkerWakeCursor(boot, cursor)
            previous.fold(Response[F](Status.BadRequest).pure[F])(c =>
              response(wake.await(Some(c)))
            )
          case "POST" if query.isEmpty => response(wake.advance)
          case "POST" if query == Vector("uncertain" -> Some("true")) => response(wake.invalidate)
          case "POST" => Response[F](Status.BadRequest).pure[F]
          case _ => Response[F](Status.MethodNotAllowed).pure[F]
    }
