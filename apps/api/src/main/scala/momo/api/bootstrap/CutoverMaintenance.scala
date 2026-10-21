package momo.api.bootstrap

import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.attribute.PosixFilePermissions
import java.nio.file.{Files, Path, StandardCopyOption, StandardOpenOption}
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import io.circe.Json
import org.http4s.{HttpApp, Method, Response, Status}

import momo.api.config.AppConfig
import momo.api.db.Database

/** A separate boot path: no application wiring, background jobs, or external clients. */
private[api] object CutoverMaintenance:
  private val prefix = "MOMO_CUTOVER_"

  private[api] def enabled(env: Map[String, String]): Either[Throwable, Boolean] =
    env.get(prefix + "MODE") match
      case None if !env.keys.exists(_.startsWith(prefix)) => Right(false)
      case Some("maintenance") => Right(true)
      case _ => Left(new IllegalArgumentException("Invalid cutover execution mode"))

  def runtime(config: AppConfig, env: Map[String, String]): Resource[IO, ApiApp.Runtime[IO]] =
    Resource.eval(enabled(env).liftTo[IO]).flatMap {
      case false => ApiApp.wired[IO](config)
      case true =>
        for
          expected <- Resource.eval(expectations(env).liftTo[IO])
          db <-
            Resource.eval(config.database.toRight(new IllegalArgumentException("Database required"))
              .liftTo[IO])
          observation <- Resource.eval(Database.transactor[IO](db).use { xa =>
            (for
              _ <- sql"SET TRANSACTION READ ONLY".update.run
              identity <-
                sql"SELECT current_database(), current_user::text, session_user::text".query[(
                    String,
                    String,
                    String
                )].unique
              ledger <-
                sql"SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id".query[(
                    String,
                    String
                )].to[List]
            yield (identity, ledger)).transact(xa)
          })
          _ <- Resource.eval(IO.blocking {
            val ((database, role, loginRole), ledger) = observation
            val rows = Json.arr(ledger.map { case (hash, createdAt) =>
              Json.obj(
                "hash" -> Json.fromString(hash),
                "created_at" -> Json.fromString(createdAt)
              )
            }*)
            val hash = MessageDigest.getInstance("SHA-256").digest(rows.noSpaces.getBytes(UTF_8))
              .map(b => f"${b & 0xff}%02x").mkString
            require(
              database == expected.database && role == expected.role && loginRole == role &&
                hash == expected.ledger,
              "Cutover database identity mismatch"
            )
            val report = Json.obj(
              "formatVersion" -> Json.fromInt(1),
              "consumer" -> Json.fromString("api"),
              "mode" -> Json.fromString("maintenance"),
              "observedAt" -> Json.fromString(Instant.now().toString),
              "role" -> Json.fromString(role),
              "database" -> Json.fromString(database),
              "ledger" -> rows,
              "readOnly" -> Json.True,
              "machine" -> Json.obj(
                "id" -> Json.fromString(env.getOrElse(
                  "FLY_MACHINE_ID",
                  env.getOrElse("HOSTNAME", "local")
                )),
                "bootId" -> Json.fromString(UUID.randomUUID().toString),
                "imageDigest" -> Json.fromString(expected.image)
              )
            )
            val temporary = Files.createTempFile(
              expected.report.getParent,
              ".cutover-",
              ".json",
              PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))
            )
            try
              Files.writeString(temporary, report.noSpaces, StandardOpenOption.WRITE)
              Files.move(
                temporary,
                expected.report,
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING
              )
            finally { val _ = Files.deleteIfExists(temporary) }
          })
        yield ApiApp.Runtime[IO](
          HttpApp[IO] { request =>
            IO.pure(Response[IO](if request.method === Method.GET &&
              request.uri.path.renderString == "/healthz"
            then Status.Ok
            else Status.ServiceUnavailable))
          },
          IO.never
        )
    }

  private final case class Expectations(
      database: String,
      role: String,
      ledger: String,
      image: String,
      report: Path
  )

  private def expectations(env: Map[String, String]): Either[Throwable, Expectations] =
    def required(name: String): Either[Throwable, String] =
      env.get(prefix + name).filter(_.nonEmpty)
        .toRight(new IllegalArgumentException("Missing cutover setting"))
    for
      database <- required("EXPECTED_DATABASE")
      role <- required("EXPECTED_ROLE")
      image <- required("IMAGE_DIGEST")
      ledger <- required("EXPECTED_LEDGER_SHA256")
      path <- required("REPORT_PATH")
      report <- Either.catchNonFatal(Path.of(path))
      _ <- Either.cond(
        image.matches("sha256:[0-9a-f]{64}") && ledger.matches("[0-9a-f]{64}") && report.isAbsolute,
        (),
        new IllegalArgumentException("Invalid cutover settings")
      )
    yield Expectations(database, role, ledger, image, report)
