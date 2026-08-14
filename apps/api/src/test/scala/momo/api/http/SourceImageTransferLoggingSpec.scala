package momo.api.http

import cats.effect.{Deferred, IO}
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.spi.ILoggingEvent
import fs2.Stream

import momo.api.MomoCatsEffectSuite
import momo.api.testing.LogbackCapture

final class SourceImageTransferLoggingSpec extends MomoCatsEffectSuite:
  private val context = SourceImageTransferContext(
    requestId = "request-source-stream-1",
    event = "source_image_transfer_completed",
    fields = "accountId=account_ponta draftId=draft-1 kind=total_assets expectedBodyBytes=3",
  )

  test("logs safe domain fields and MDC exactly once after a successful pull"):
    captureLogs { events =>
      for
        observed = SourceImageTransferLogging.observe(
          Stream.emits[IO, Byte](Array[Byte](1, 2, 3)),
          context,
        )
        beforePull <- events
        bytes <- observed.compile.toList
        afterPull <- events
      yield
        assertEquals(beforePull, Vector.empty)
        assertEquals(bytes, List[Byte](1, 2, 3))
        assertEquals(afterPull.size, 1)
        val event = afterPull.head
        assertEquals(event.getLevel, Level.INFO)
        assertEquals(event.getMDCPropertyMap.get("request_id"), context.requestId)
        assert(event.getFormattedMessage.contains("outcome=succeeded bodyBytes=3"))
        assert(event.getFormattedMessage.contains("expectedBodyBytes=3"))
    }

  test("logs error and cancellation as warnings without exception messages"):
    val failure = new RuntimeException("secret failure detail")
    val errored = Stream.emit[IO, Byte](1) ++ Stream.raiseError[IO](failure)

    captureLogs { events =>
      for
        erroredResult <- SourceImageTransferLogging.observe(errored, context).compile.drain.attempt
        started <- Deferred[IO, Unit]
        release <- Deferred[IO, Unit]
        canceled = SourceImageTransferLogging.observe(
          Stream.eval(started.complete(())) >> Stream.eval(release.get) >> Stream.emit[IO, Byte](2),
          context,
        )
        fiber <- canceled.compile.drain.start
        _ <- started.get
        _ <- fiber.cancel
        captured <- events
      yield
        assertEquals(erroredResult, Left(failure))
        assertEquals(captured.size, 2)
        assertEquals(captured.map(_.getLevel), Vector.fill(2)(Level.WARN))
        val messages = captured.map(_.getFormattedMessage)
        assert(messages.exists(_.contains("outcome=errored bodyBytes=1")))
        assert(messages.exists(_.contains("outcome=canceled bodyBytes=0")))
        assert(messages.forall(!_.contains(failure.getMessage)))
        assert(captured.forall(_.getMDCPropertyMap.get("request_id") == context.requestId))
    }

  private def captureLogs[A](use: IO[Vector[ILoggingEvent]] => IO[A]): IO[A] =
    LogbackCapture.withEvents("momo.api.http.SourceImageTransferLogging", Level.INFO)(use)
