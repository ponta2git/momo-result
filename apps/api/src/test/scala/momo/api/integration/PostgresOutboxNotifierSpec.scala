package momo.api.integration

import cats.effect.{IO, Resource}
import org.postgresql.PGConnection

import momo.api.adapters.postgres.PostgresOutboxNotifier
import momo.api.usecases.queue.OutboxDrainResult

final class PostgresOutboxNotifierSpec extends IntegrationSuite:
  PostgresOutboxNotifier.Channel.values.foreach { channel =>
    test(s"relays a payloadless ${channel.value} notification and becomes idle"):
      listener(channel).use { connection =>
        val postgres = connection.unwrap(classOf[PGConnection])
        val notifier = PostgresOutboxNotifier[IO](transactor, channel)
        for
          submitted <- notifier.drainBatch
          notifications <- IO.blocking(Option(postgres.getNotifications(5000)).toList.flatten)
        yield
          assertEquals(submitted, OutboxDrainResult.Idle(None))
          assertEquals(notifications.map(_.getName).toList, List(channel.value))
          assertEquals(notifications.map(_.getParameter).toList, List(""))
      }
  }

  private def listener(channel: PostgresOutboxNotifier.Channel): Resource[IO, java.sql.Connection] =
    Resource
      .fromAutoCloseable(IO.blocking(dataSource.getConnection))
      .evalTap(connection =>
        IO.blocking {
          val statement = connection.createStatement()
          try statement.execute(s"LISTEN ${channel.value}")
          finally statement.close()
        }
      )

end PostgresOutboxNotifierSpec
