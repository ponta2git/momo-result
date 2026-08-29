package momo.api.integration

import cats.effect.{IO, Resource}
import org.postgresql.PGConnection

import momo.api.adapters.postgres.PostgresSeriesAnalysisOutboxWakeSink
import momo.api.usecases.queue.{
  OutboxKind,
  OutboxWakeSubmitResult,
  PostCommitEffects
}

final class PostgresSeriesAnalysisOutboxWakeSinkSpec extends IntegrationSuite:
  test("emits one payloadless notification on the fixed channel for analysis effects"):
    listener.use { connection =>
      val postgres = connection.unwrap(classOf[PGConnection])
      val sink = PostgresSeriesAnalysisOutboxWakeSink[IO](transactor)
      for
        ignored <- sink.submit(PostCommitEffects.wake(OutboxKind.Ocr))
        before <- IO.blocking(Option(postgres.getNotifications(25)).toList.flatten)
        submitted <- sink.submit(PostCommitEffects.wake(OutboxKind.SeriesAnalysis))
        notifications <- IO.blocking(Option(postgres.getNotifications(5000)).toList.flatten)
      yield
        assertEquals(ignored, OutboxWakeSubmitResult.Accepted)
        assertEquals(before, Nil)
        assertEquals(submitted, OutboxWakeSubmitResult.Accepted)
        assertEquals(notifications.map(_.getName).toList, List(
          PostgresSeriesAnalysisOutboxWakeSink.Channel
        ))
        assertEquals(notifications.map(_.getParameter).toList, List(""))
    }

  private def listener: Resource[IO, java.sql.Connection] = Resource
    .fromAutoCloseable(IO.blocking(dataSource.getConnection))
    .evalTap(connection => IO.blocking {
      val statement = connection.createStatement()
      try statement.execute(s"LISTEN ${PostgresSeriesAnalysisOutboxWakeSink.Channel}")
      finally statement.close()
    })

end PostgresSeriesAnalysisOutboxWakeSinkSpec
