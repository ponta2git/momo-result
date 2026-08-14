package momo.api.http

import scala.jdk.CollectionConverters.*

import cats.effect.{Deferred, IO, Resource}
import ch.qos.logback.classic.{Level, Logger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import fs2.Stream
import org.slf4j.LoggerFactory

import momo.api.MomoCatsEffectSuite

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
    val logger = IO.delay(LoggerFactory.getLogger("momo.api.http.SourceImageTransferLogging"))
      .flatMap {
        case logback: Logger => IO.pure(logback)
        case other => IO.raiseError(new IllegalStateException(
            s"Expected logback logger, got ${other.getClass.getName}"
          ))
      }
    Resource.make(logger.flatMap { logback =>
      IO.delay {
        val appender = new ListAppender[ILoggingEvent]()
        appender.start()
        val originalLevel = logback.getLevel
        logback.setLevel(Level.INFO)
        logback.addAppender(appender)
        (logback, appender, originalLevel)
      }
    }) { case (logback, appender, originalLevel) =>
      IO.delay {
        logback.detachAppender(appender)
        logback.setLevel(originalLevel)
        appender.stop()
      }
    }.use { case (_, appender, _) =>
      use(IO.delay(appender.list.asScala.toVector))
    }
