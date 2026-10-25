package momo.api.tools

import java.nio.file.{Files, Path}
import java.sql.SQLException
import java.time.Instant

import cats.effect.{ExitCode, IO, IOApp}
import cats.syntax.all.*
import doobie.implicits.*

import momo.api.adapters.postgres.{PostgresAchievementInitialization, PostgresIdentities}
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.domain.AchievementMutationContext

/** Explicit local/operator command; dry-run is the default and never writes personal source data. */
object InitialAchievementImport extends IOApp:
  private final case class InputFailure(message: String) extends RuntimeException(message)
  private final case class Options(
      manifest: Path,
      mapping: Path,
      source: Path,
      applyChanges: Boolean
  )

  override def run(args: List[String]): IO[ExitCode] =
    (for
      options <- parseOptions(args).leftMap(InputFailure.apply).liftTo[IO]
      inputs <- IO.blocking((
        Files.readString(options.manifest),
        Files.readString(options.mapping),
        Files.readString(options.source)
      ))
      prepared <- InitialAchievementInput.prepare(inputs._1, inputs._2, inputs._3)
        .leftMap(InputFailure.apply).liftTo[IO]
      config <- AppConfig.load[IO]
      db <- config.database.toRight(InputFailure("DATABASE_URL must select the intended database."))
        .liftTo[IO]
      context = AchievementMutationContext(prepared.accountId, Instant.now())
      _ <- Database.transactor[IO](db).use { xa =>
        PostgresIdentities.discover.transact(xa).flatMap { identities =>
          val action =
            for
              _ <- if options.applyChanges then ().pure[doobie.ConnectionIO]
              else sql"SET TRANSACTION READ ONLY".update.run.void
              _ <- if options.applyChanges then
                PostgresAchievementInitialization.initialize(prepared.command, context, identities)
              else PostgresAchievementInitialization.validate(prepared.command, context, identities)
            yield ()
          action.transact(xa)
        }
      }
      mode = if options.applyChanges then "applied (existing definitions and claims preserved)"
      else "dry-run validated (no changes)"
      _ <- IO.println(
        s"Initial achievements: $mode; items=${prepared.command.items.size.toString}, " +
          s"confirmed=${prepared.confirmed.toString}, unconfirmed=${prepared.unconfirmed.toString}.\n" +
          s"Source ${prepared.sourceChecksum}\nManifest ${prepared.manifestChecksum}"
      )
    yield ExitCode.Success).handleErrorWith {
      case InputFailure(message) => IO.println(message).as(ExitCode.Error)
      case error: SQLException =>
        IO.println(
          s"Achievement initialization failed (SQLSTATE ${Option(error.getSQLState).getOrElse("unknown")}). No partial import was committed."
        )
          .as(ExitCode.Error)
      case error => IO.println(
          s"Achievement initialization failed (${error.getClass.getSimpleName}). No partial import was committed."
        )
          .as(ExitCode.Error)
    }

  private def parseOptions(args: List[String]): Either[String, Options] =
    val values = args.filterNot(_ == "--apply")
    val expected = Set("--manifest", "--mapping", "--tsv")
    if values.length != 6 || values.grouped(2).map(_.head).toSet != expected ||
      args.count(_ == "--apply") > 1
    then
      Left(
        "Usage: InitialAchievementImport --manifest <catalog.json> --mapping <mapping.json> --tsv <source.tsv> [--apply]"
      )
    else
      val options = values.grouped(2).map(pair => pair.head -> pair(1)).toMap
      Right(Options(
        Path.of(options("--manifest")),
        Path.of(options("--mapping")),
        Path.of(options("--tsv")),
        args.contains("--apply")
      ))
