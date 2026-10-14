package momo.api.integration

import cats.effect.{IO, Resource}
import org.postgresql.PGConnection

import momo.api.adapters.postgres.PostgresWorkerNotifier

final class PostgresWorkerNotifierSpec extends IntegrationSuite:
  PostgresWorkerNotifier.Channel.values.foreach { channel =>
    test(s"relays a payloadless ${channel.value} notification and becomes idle"):
      listener(channel).use { connection =>
        val postgres = connection.unwrap(classOf[PGConnection])
        val notifier = PostgresWorkerNotifier[IO](transactor, channel)
        for
          _ <- notifier.notifyWorker
          notifications <- IO.blocking(Option(postgres.getNotifications(5000)).toList.flatten)
        yield
          assertEquals(notifications.map(_.getName).toList, List(channel.value))
          assertEquals(notifications.map(_.getParameter).toList, List(""))
      }
  }

  private def listener(channel: PostgresWorkerNotifier.Channel): Resource[IO, java.sql.Connection] =
    Resource
      .fromAutoCloseable(IO.blocking(dataSource.getConnection))
      .evalTap(connection =>
        IO.blocking {
          val statement = connection.createStatement()
          try statement.execute(s"LISTEN ${channel.value}")
          finally statement.close()
        }
      )

end PostgresWorkerNotifierSpec
