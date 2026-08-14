package momo.api.http

import scala.jdk.CollectionConverters.*

import cats.data.Kleisli
import cats.effect.{Deferred, IO, Resource}
import ch.qos.logback.classic.{Level, Logger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import fs2.Stream
import org.http4s.{Header, HttpApp, Request, Response, Status, Uri}
import org.slf4j.LoggerFactory

import momo.api.MomoCatsEffectSuite

final class RequestDurationLoggingMiddlewareSpec extends MomoCatsEffectSuite:
  private val request = Request[IO](uri = Uri.unsafeFromString("/stream")).putHeaders(
    Header.Raw(RequestIdMiddleware.HeaderName, "request-stream-1")
  )

  test("logs readiness before pull and successful transfer only after the body is consumed"):
    val app = middleware(Stream.emits[IO, Byte](Array[Byte](1, 2, 3)))

    captureLogs { events =>
      for
        response <- app.run(request)
        beforePull <- events
        body <- response.body.compile.toList
        afterPull <- events
      yield
        assertEquals(body, List[Byte](1, 2, 3))
        assertEquals(messages(beforePull).count(_.startsWith("http_response_ready ")), 1)
        assert(!messages(beforePull).exists(_.startsWith("http_response_transfer_completed ")))
        val completed = messages(afterPull)
          .filter(_.startsWith("http_response_transfer_completed "))
        assertEquals(completed.size, 1)
        assert(completed.head.contains("outcome=succeeded"))
        assert(completed.head.contains("bodyBytes=3"))
        assert(completed.head.contains("requestId=request-stream-1"))
        val completedEvent = afterPull.find(_.getFormattedMessage.startsWith(
          "http_response_transfer_completed "
        )).getOrElse(fail("expected transfer-completed event"))
        assertEquals(completedEvent.getMDCPropertyMap.get("request_id"), "request-stream-1")
    }

  test("logs an errored body once with only bytes pulled from the observed stream"):
    val failure = new RuntimeException("stream failed")
    val body = Stream.emits[IO, Byte](Array[Byte](1, 2)) ++ Stream.raiseError[IO](failure)
    val app = middleware(body)

    captureLogs { events =>
      for
        response <- app.run(request)
        result <- response.body.compile.drain.attempt
        captured <- events
      yield
        assertEquals(result, Left(failure))
        val completed = messages(captured)
          .filter(_.startsWith("http_response_transfer_completed "))
        assertEquals(completed.size, 1)
        assert(completed.head.contains("outcome=errored"))
        assert(completed.head.contains("bodyBytes=2"))
        assert(completed.head.contains("errorClass=java.lang.RuntimeException"))
        assert(!completed.head.contains(failure.getMessage))
    }

  test("logs cancellation once and does not report the transfer as successful"):
    for
      started <- Deferred[IO, Unit]
      release <- Deferred[IO, Unit]
      body = Stream.eval(started.complete(())) >> Stream.eval(release.get) >>
        Stream.emit[IO, Byte](1)
      _ <- captureLogs { events =>
        for
          response <- middleware(body).run(request)
          fiber <- response.body.compile.drain.start
          _ <- started.get
          _ <- fiber.cancel
          captured <- events
        yield
          val completed = messages(captured)
            .filter(_.startsWith("http_response_transfer_completed "))
          assertEquals(completed.size, 1)
          assert(completed.head.contains("outcome=canceled"))
          assert(completed.head.contains("bodyBytes=0"))
      }
    yield ()

  private def middleware(body: Stream[IO, Byte]): HttpApp[IO] =
    RequestDurationLoggingMiddleware[IO](Kleisli(_ =>
      IO.pure(
        Response[IO](Status.Ok).withBodyStream(body)
      )
    ))

  private def messages(events: Vector[ILoggingEvent]): Vector[String] =
    events.map(_.getFormattedMessage)

  private def captureLogs[A](
      use: IO[Vector[ILoggingEvent]] => IO[A]
  ): IO[A] =
    val logger = IO.delay(
      LoggerFactory.getLogger("momo.api.http.RequestDurationLoggingMiddleware")
    ).flatMap {
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
