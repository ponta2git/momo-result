package momo.api.http

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import ch.qos.logback.classic.LoggerContext
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory

import momo.api.MomoCatsEffectSuite
import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

final class EndpointSecuritySpec extends MomoCatsEffectSuite:
  test("logs incident AppErrors returned as endpoint values without leaking details") {
    val secret = "postgres://user:secret@example.com/db"
    val security = EndpointSecurity[IO](NoopAuthPolicy)

    for
      (_, events) <- captureEndpointSecurityLogs(
        security.respond(IO.pure(Left[AppError, Unit](AppError.Internal(s"invalid $secret"))))(
          identity
        )
      )
      rendered = events.map(_.getFormattedMessage).mkString("\n")
    yield
      assert(rendered.contains("problemCode=INTERNAL_ERROR"))
      assert(!rendered.contains(secret))
      assert(events.forall(event => Option(event.getThrowableProxy).isEmpty))
  }

  test("does not log expected AppErrors returned as endpoint values") {
    val security = EndpointSecurity[IO](NoopAuthPolicy)

    for
      (_, events) <- captureEndpointSecurityLogs(
        security.respond(IO.pure(Left[AppError, Unit](AppError.Conflict("already exists"))))(
          identity
        )
      )
    yield assert(events.isEmpty)
  }

  private def captureEndpointSecurityLogs[A](fa: IO[A]): IO[(A, Vector[ILoggingEvent])] =
    val logger = IO.delay(LoggerFactory.getILoggerFactory).flatMap {
      case context: LoggerContext =>
        IO.delay(context.getLogger("momo.api.http.EndpointSecurity"))
      case other => IO
          .raiseError(new IllegalStateException(s"Expected logback context, got ${other.getClass
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

  private object NoopAuthPolicy extends AuthPolicy[IO]:
    override def authenticate(
        accountHeader: Option[String]
    ): IO[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] =
      IO.pure(Left(ProblemDetails.from(AppError.Unauthorized())))

    override def verifyCsrf(
        csrfToken: Option[String]
    ): IO[Either[ProblemDetails.ProblemResponse, Unit]] =
      IO.pure(Left(ProblemDetails.from(AppError.Unauthorized())))
