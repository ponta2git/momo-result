package momo.api.http

import java.sql.SQLException

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.circe.parser.parse
import org.http4s.{HttpRoutes, Request, Status, Uri}
import org.slf4j.LoggerFactory

import momo.api.MomoCatsEffectSuite
import momo.api.errors.{AppError, AppException}

final class HttpErrorMiddlewareSpec extends MomoCatsEffectSuite:
  test("maps database exceptions to sanitized dependency ProblemDetails") {
    val app = HttpErrorMiddleware[IO](HttpRoutes.of[IO] { case _ =>
      IO.raiseError(new SQLException("relation secret_table missing"))
    }.orNotFound)

    for
      response <- app.run(Request[IO](uri = Uri.unsafeFromString("/boom")))
      body <- response.as[String]
      json <- IO.fromEither(parse(body))
    yield
      assertEquals(response.status, Status.ServiceUnavailable)
      assertEquals(json.hcursor.get[String]("code"), Right("DEPENDENCY_FAILED"))
      assertEquals(json.hcursor.get[String]("detail"), Right("Database operation failed."))
      assert(!body.contains("secret_table"))
  }

  test("logs dependency exceptions without leaking exception messages") {
    val secret = "postgres://user:secret@db.example.com/momo"
    val app = HttpErrorMiddleware[IO](HttpRoutes.of[IO] { case _ =>
      IO.raiseError(new SQLException(s"relation secret_table missing $secret"))
    }.orNotFound)

    for
      (_, events) <- captureHttpErrorLogs(app.run(Request[IO](uri = Uri.unsafeFromString("/boom"))))
      rendered = events.map(_.getFormattedMessage).mkString("\n")
    yield
      assert(rendered.contains("java.sql.SQLException"))
      assert(!rendered.contains("secret_table"))
      assert(!rendered.contains(secret))
      assert(events.forall(event => Option(event.getThrowableProxy).isEmpty))
  }

  test("does not log expected application errors as incidents") {
    val app = HttpErrorMiddleware[IO](HttpRoutes.of[IO] { case _ =>
      IO.raiseError(new AppException(AppError.Conflict("match already exists")))
    }.orNotFound)

    for
      (response, events) <-
        captureHttpErrorLogs(app.run(Request[IO](uri = Uri.unsafeFromString("/conflict"))))
      body <- response.as[String]
      json <- IO.fromEither(parse(body))
    yield
      assertEquals(response.status, Status.Conflict)
      assertEquals(json.hcursor.get[String]("code"), Right("CONFLICT"))
      assert(events.isEmpty)
  }

  test("logs application internal errors as incidents") {
    val app = HttpErrorMiddleware[IO](HttpRoutes.of[IO] { case _ =>
      IO.raiseError(new AppException(AppError.Internal("Stored response could not be decoded.")))
    }.orNotFound)

    for
      (_, events) <-
        captureHttpErrorLogs(app.run(Request[IO](uri = Uri.unsafeFromString("/internal"))))
      rendered = events.map(_.getFormattedMessage).mkString("\n")
    yield
      assert(rendered.contains("problemCode=INTERNAL_ERROR"))
      assert(rendered.contains(classOf[AppException].getName))
  }

  private def captureHttpErrorLogs[A](fa: IO[A]): IO[(A, Vector[ILoggingEvent])] =
    val logger = IO.delay(LoggerFactory.getLogger("momo.api.http.HttpErrorMiddleware")).flatMap {
      case logback: Logger => IO.pure(logback)
      case other => IO
          .raiseError(new IllegalStateException(s"Expected logback logger, got ${other.getClass
              .getName}"))
    }
    Resource.make(logger.flatMap { logback =>
      IO.delay {
        val appender = new ListAppender[ILoggingEvent]()
        appender.start()
        logback.addAppender(appender)
        (logback, appender)
      }
    }) { case (logback, appender) =>
      IO.delay {
        logback.detachAppender(appender)
        appender.stop()
      }
    }.use { case (_, appender) => fa.map(result => (result, appender.list.asScala.toVector)) }
