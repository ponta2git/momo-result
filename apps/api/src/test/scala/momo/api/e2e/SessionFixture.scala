package momo.api.e2e

import java.nio.file.attribute.PosixFilePermissions
import java.nio.file.{Files, Path}

import cats.effect.std.SecureRandom
import cats.effect.{IO, IOApp}
import cats.syntax.all.*
import doobie.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.{PostgresAppSessionsRepository, PostgresLoginAccountsRepository}
import momo.api.auth.SessionService
import momo.api.config.{AppConfig, AppEnv}
import momo.api.db.Database
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.repositories.CreateLoginAccountData

/** Creates credentials only in the disposable database owned by the system E2E runner. */
object SessionFixture extends IOApp.Simple:
  override def run: IO[Unit] =
    for
      _ <- IO.raiseUnless(sys.env.get("E2E_SERVICES_ARE_ISOLATED").contains("true"))(
        new IllegalArgumentException("Session fixtures require E2E_SERVICES_ARE_ISOLATED=true")
      )
      output <- IO.fromOption(sys.env.get("E2E_SESSION_FIXTURE_PATH"))(
        new IllegalArgumentException("E2E_SESSION_FIXTURE_PATH is required")
      ).map(Path.of(_))
      _ <- IO.raiseWhen(!output.isAbsolute)(
        new IllegalArgumentException("E2E_SESSION_FIXTURE_PATH must be absolute")
      )
      config <- AppConfig.load[IO]
      _ <- IO.raiseWhen(config.appEnv != AppEnv.Dev)(
        new IllegalArgumentException("Session fixtures require APP_ENV=dev")
      )
      database <- IO.fromOption(config.database)(
        new IllegalArgumentException("Session fixtures require a disposable database")
      )
      random <- SecureRandom.javaSecuritySecureRandom[IO]
      payload <- Database.transactor[IO](database).use { transactor =>
        given SecureRandom[IO] = random
        val accounts = PostgresLoginAccountsRepository[IO](transactor)
        val sessions = SessionService[IO](
          PostgresAppSessionsRepository[IO](transactor),
          accounts,
          config.auth.sessionTtl,
          IO.realTimeInstant,
        )
        def seeded(id: String, role: AccountRole): IO[LoginAccount] =
          accounts.find(AccountId.unsafeFromString(id)).flatMap { account =>
            IO.fromOption(account.filter(value => value.loginEnabled && value.role == role))(
              new IllegalStateException(s"Expected enabled ${role.wire} fixture account $id")
            )
          }
        for
          databaseName <- sql"SELECT current_database()".query[String].unique.transact(transactor)
          _ <- IO.raiseUnless(databaseName == "mom24_e2e")(
            new IllegalArgumentException("Session fixtures require the mom24_e2e database")
          )
          administrator <- seeded("account_ponta", AccountRole.Admin)
          user <- seeded("account_eu", AccountRole.User)
          now <- IO.realTimeInstant
          operator <- accounts.create(CreateLoginAccountData(
            id = AccountId.unsafeFromString("account_e2e_operator"),
            discordUserId = UserId.unsafeFromString("623456789012345679"),
            displayName = "E2E operator",
            playerMemberId = None,
            loginEnabled = true,
            role = AccountRole.Operator,
            createdAt = now,
            updatedAt = now,
          )).flatMap(result => IO.fromOption(result.toOption)(
            new IllegalStateException("Could not create disposable operator fixture")
          ))
          credentials <- List(
            "admin" -> administrator,
            "operator" -> operator,
            "user" -> user,
            "logout" -> administrator,
          )
            .traverse { (role, account) =>
              sessions.create(account).map(created => role -> Json.obj(
                "accountId" -> Json.fromString(account.id.value),
                "cookieValue" -> Json.fromString(created.cookieValue),
              ))
            }
        yield Json.obj(
          "cookieName" -> Json.fromString(config.auth.sessionCookieName),
          "sessions" -> Json.obj(credentials*),
        )
      }
      _ <- IO.blocking {
        // CREATE_NEW semantics reject existing files and symlinks; permissions precede content.
        Files.createFile(output, PosixFilePermissions.asFileAttribute(
          PosixFilePermissions.fromString("rw-------")
        ))
        Files.writeString(output, payload.noSpaces)
        ()
      }
    yield ()
