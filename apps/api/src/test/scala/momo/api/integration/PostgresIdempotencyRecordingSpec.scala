package momo.api.integration

import java.sql.SQLException
import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{IO, Resource}
import doobie.Transactor

import momo.api.adapters.postgres.PostgresIdempotencyRepository
import momo.api.domain.ids.AccountId
import momo.api.repositories.{IdempotencyRecord, IdempotencyResponse}

final class PostgresIdempotencyRecordingSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-05-14T00:00:00Z")
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val endpoint = "POST /api/testing/recording"
  private val hash = Vector.fill[Byte](32)(1)
  private val response = IdempotencyResponse(200, Map.empty, "{}".getBytes.toVector)

  private def pending(key: String): IdempotencyRecord = IdempotencyRecord(
    key,
    accountId,
    endpoint,
    hash,
    IdempotencyResponse(0, Map.empty, Vector.empty),
    now,
    now.plusSeconds(86400)
  )

  for complete <- List(true, false) do
    val operation = if complete then "complete" else "abandon"
    test(s"$operation bounds a PostgreSQL row-lock wait and preserves the pending reservation") {
      val repo = PostgresIdempotencyRepository[IO](transactor)
      val key = s"locked-$operation"
      val write = if complete then repo.complete(key, accountId, endpoint, hash, response)
      else repo.abandon(key, accountId, endpoint, hash)
      for
        _ <- repo.reserveWithinAccountLimit(pending(key), now, 100)
        result <- lockedKey(key).use(_ => write.attempt.timeout(5.seconds))
        saved <- repo.lookup(key, accountId, endpoint)
      yield
        assert(
          result.left.exists {
            case error: SQLException => error.getSQLState == "57014"
            case _ => false
          },
          "The per-statement deadline must interrupt a real PostgreSQL lock wait."
        )
        assertEquals(saved.map(_.response.status), Some(0))
    }

  test("recording restores a borrowed connection's network timeout after success and failure") {
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection())).use { connection =>
      val directExecutor: java.util.concurrent.Executor = command => command.run()
      val repo = PostgresIdempotencyRepository[IO](Transactor.fromConnection[IO](connection, None))
      val key = "scoped-network-timeout"
      for
        previous <- IO.blocking(connection.getNetworkTimeout)
        result <- Resource.make(IO.blocking(connection.setNetworkTimeout(directExecutor, 7500)))(
          _ => IO.blocking(connection.setNetworkTimeout(directExecutor, previous))
        ).use { _ =>
          for
            _ <- repo.reserveWithinAccountLimit(pending(key), now, 100)
            _ <- repo.complete(key, accountId, endpoint, hash, response)
            afterSuccess <- IO.blocking(connection.getNetworkTimeout)
            failure <- lockedKey(key).use(_ =>
              repo.complete(key, accountId, endpoint, hash, response).attempt
            )
            afterFailure <- IO.blocking(connection.getNetworkTimeout)
          yield (afterSuccess, failure.isLeft, afterFailure)
        }
      yield assertEquals(result, (7500, true, 7500))
    }
  }

  private def lockedKey(key: String): Resource[IO, Unit] = Resource
    .fromAutoCloseable(IO.blocking(dataSource.getConnection())).flatMap { connection =>
      Resource.make(IO.blocking(connection.setAutoCommit(false)))(_ =>
        IO.blocking(connection.rollback())
      ).evalTap { _ =>
        IO.blocking {
          val statement = connection.prepareStatement(
            "SELECT key FROM idempotency_keys WHERE key = ? FOR UPDATE"
          )
          try
            statement.setString(1, key)
            val rows = statement.executeQuery()
            try assert(rows.next())
            finally rows.close()
          finally statement.close()
        }
      }
    }
