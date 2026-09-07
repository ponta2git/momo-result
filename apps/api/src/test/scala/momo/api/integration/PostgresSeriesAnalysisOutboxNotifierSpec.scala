package momo.api.integration

import cats.effect.{IO, Resource}
import org.postgresql.PGConnection

import momo.api.adapters.postgres.PostgresSeriesAnalysisOutboxNotifier
import momo.api.usecases.queue.OutboxDrainResult

final class PostgresSeriesAnalysisOutboxNotifierSpec extends IntegrationSuite:
  test("relays one payloadless notification to the worker listener and becomes idle"):
    listener.use { connection =>
      val postgres = connection.unwrap(classOf[PGConnection])
      val notifier = PostgresSeriesAnalysisOutboxNotifier[IO](transactor)
      for
        submitted <- notifier.drainBatch
        notifications <- IO.blocking(Option(postgres.getNotifications(5000)).toList.flatten)
      yield
        assertEquals(submitted, OutboxDrainResult.Idle(None))
        assertEquals(
          notifications.map(_.getName).toList,
          List(
            PostgresSeriesAnalysisOutboxNotifier.Channel
          )
        )
        assertEquals(notifications.map(_.getParameter).toList, List(""))
    }

  private def listener: Resource[IO, java.sql.Connection] = Resource
    .fromAutoCloseable(IO.blocking(dataSource.getConnection))
    .evalTap(connection =>
      IO.blocking {
        val statement = connection.createStatement()
        try statement.execute(s"LISTEN ${PostgresSeriesAnalysisOutboxNotifier.Channel}")
        finally statement.close()
      }
    )

end PostgresSeriesAnalysisOutboxNotifierSpec
