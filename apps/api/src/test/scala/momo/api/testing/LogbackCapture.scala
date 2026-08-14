package momo.api.testing

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.{Level, Logger}
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory

object LogbackCapture:
  def withEvents[A](
      loggerName: String,
      level: Level,
  )(use: IO[Vector[ILoggingEvent]] => IO[A]): IO[A] = Resource
    .make(resolveLogger(loggerName).flatMap { logger =>
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

  // SLF4J initializes its provider under this monitor. Taking the same monitor keeps parallel test
  // suites from observing the temporary substitute provider without adding a wall-clock wait.
  private def resolveLogger(loggerName: String): IO[Logger] = IO
    .blocking(classOf[LoggerFactory].synchronized(LoggerFactory.getLogger(loggerName)))
    .flatMap {
      case logger: Logger => IO.pure(logger)
      case other => IO.raiseError(new IllegalStateException(
          s"Expected logback logger, got ${other.getClass.getName}"
        ))
    }
