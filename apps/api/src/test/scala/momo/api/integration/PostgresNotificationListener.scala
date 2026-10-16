package momo.api.integration

import java.sql.Connection
import javax.sql.DataSource

import cats.effect.{IO, Resource}
import org.postgresql.PGConnection

import momo.api.adapters.postgres.PostgresWorkerNotifier

/** Owns LISTEN state for a dedicated borrowed session, including cleanup before pool return. */
private[integration] object PostgresNotificationListener:
  def resource(
      dataSource: DataSource,
      channel: PostgresWorkerNotifier.Channel,
  ): Resource[IO, Connection] = Resource
    .fromAutoCloseable(IO.blocking(dataSource.getConnection))
    .flatMap { connection =>
      Resource.make(IO.unit)(_ => IO.blocking {
        execute(connection, "UNLISTEN *")
        // UNLISTEN stops new delivery; consume notifications already buffered by the driver.
        val _ = connection.unwrap(classOf[PGConnection]).getNotifications()
      }).evalTap(_ => IO.blocking {
          connection.setAutoCommit(true)
          execute(connection, s"LISTEN ${channel.value}")
      }).map(_ => connection)
    }

  private def execute(connection: Connection, sql: String): Unit =
    val statement = connection.createStatement()
    try
      val _ = statement.execute(sql)
    finally statement.close()
