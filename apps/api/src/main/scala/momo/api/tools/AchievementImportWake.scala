package momo.api.tools

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.UUID

import cats.effect.{IO, Resource, Sync}
import cats.syntax.all.*
import doobie.ConnectionIO
import doobie.implicits.*
import doobie.util.transactor.Transactor
import io.circe.parser.parse

import momo.api.config.WorkerWakeConfig
import momo.api.http.WorkerWakeServer

/**
 * An offline import has no API process-local state of its own. Mark its bounded transaction
 * uncertain before the first write, so even process death immediately after commit is covered.
 */
private[tools] object AchievementImportWake:
  def transact(
      config: Option[WorkerWakeConfig],
      write: ConnectionIO[Unit],
      xa: Transactor[IO],
  ): IO[Unit] = config match
    case None => write.transact(xa) // Isolated development without a configured wake service.
    case Some(wake) =>
      Resource.fromAutoCloseable(IO.blocking(
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
      )).use { client =>
        def notify[F[_]: Sync](uncertain: Boolean): F[Unit] = Sync[F].blocking {
          val host = wake.host.toString
          val authority = if host.contains(':') then s"[$host]" else host
          val suffix = if uncertain then "?uncertain=true" else ""
          val uri =
            URI.create(s"http://$authority:${wake.port.value}${WorkerWakeServer.Path}$suffix")
          val request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5))
            .header(
              "Authorization",
              s"Bearer ${wake.token}"
            ).POST(HttpRequest.BodyPublishers.noBody()).build()
          val response = client.send(
            request,
            HttpResponse.BodyHandlers.limiting(
              HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8),
              1024L
            )
          )
          response.statusCode() == 200 && parse(response.body()).toOption.exists { json =>
            val cursor = json.hcursor
            cursor.get[UUID]("boot").isRight && cursor.get[BigInt]("cursor").exists(counter =>
              counter.signum >= 0 && counter.bitLength <= 64 && (!uncertain || counter.signum == 0)
            )
          }
        }.ensure(new IllegalStateException(
          "Worker wake endpoint did not acknowledge the import."
        ))(identity).void
        (notify[ConnectionIO](uncertain = true) *> write).transact(xa) *>
          notify[IO](uncertain = false).handleErrorWith(_ =>
            IO.println(
              "Import committed. The worker will pick it up during the requested recovery."
            )
          )
      }
