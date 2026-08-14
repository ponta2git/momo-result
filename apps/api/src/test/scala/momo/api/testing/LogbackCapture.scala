package momo.api.testing

import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.{Level, Logger}
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory

object LogbackCapture:
  private val ResolveAttempts = 100

  def withEvents[A](
      loggerName: String,
      level: Level,
  )(use: IO[Vector[ILoggingEvent]] => IO[A]): IO[A] = Resource
    .make(resolveLogger(loggerName, ResolveAttempts).flatMap { logger =>
      IO.delay {
        val appender = new ListAppender[ILoggingEvent]()
        appender.start()
        val originalLevel = logger.getLevel
        logger.setLevel(level)
        logger.addAppender(appender)
        (logger, appender, originalLevel)
      }
    }) { case (logger, appender, originalLevel) =>
      IO.delay {
        logger.detachAppender(appender)
        logger.setLevel(originalLevel)
        appender.stop()
      }
    }
    .use { case (_, appender, _) => use(IO.delay(appender.list.asScala.toVector)) }

  // Parallel suites can briefly observe SLF4J's substitute provider while the real binding starts.
  // Wait for the actual Logback logger before attaching an appender instead of making tests race it.
  private def resolveLogger(loggerName: String, attemptsRemaining: Int): IO[Logger] = IO
    .delay(LoggerFactory.getLogger(loggerName))
    .flatMap {
      case logger: Logger => IO.pure(logger)
      case _ if attemptsRemaining > 0 =>
        IO.sleep(10.millis) *> resolveLogger(loggerName, attemptsRemaining - 1)
      case other => IO.raiseError(new IllegalStateException(
          s"Expected logback logger, got ${other.getClass.getName}"
        ))
    }
