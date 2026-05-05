package momo.api.usecases.testing

import cats.effect.{Ref, Sync}
import cats.syntax.all.*
import org.typelevel.log4cats.{LoggerFactory, SelfAwareStructuredLogger}

/** Captured error-log entry. Only the `error` level is recorded; other levels are no-ops. */
final case class CapturedError(message: String, throwable: Option[Throwable])

object CapturedError:
  given CanEqual[CapturedError, CapturedError] = CanEqual.derived

/**
 * Test-only LoggerFactory that captures `error` calls (with or without throwable) into a Ref. All
 * other log levels are silently dropped, mirroring `NoOpLogger`. Use this in usecase specs to
 * assert that compensation paths emit the expected error log without depending on SLF4J/logback.
 */
object CapturingLoggerFactory:
  def create[F[_]: Sync]: F[(LoggerFactory[F], Ref[F, Vector[CapturedError]])] = Ref
    .of[F, Vector[CapturedError]](Vector.empty).map { ref =>
      val factory = new LoggerFactory[F]:
        override def getLoggerFromName(name: String): SelfAwareStructuredLogger[F] =
          val _ = name
          capturingLogger(ref)
        override def fromName(name: String): F[SelfAwareStructuredLogger[F]] = Sync[F]
          .pure(getLoggerFromName(name))
      (factory, ref)
    }

  private def capturingLogger[F[_]: Sync](
      ref: Ref[F, Vector[CapturedError]]
  ): SelfAwareStructuredLogger[F] =
    val unit: F[Unit] = Sync[F].unit
    val no: F[Boolean] = Sync[F].pure(false)
    val yes: F[Boolean] = Sync[F].pure(true)
    new SelfAwareStructuredLogger[F]:
      override def isTraceEnabled: F[Boolean] = no
      override def isDebugEnabled: F[Boolean] = no
      override def isInfoEnabled: F[Boolean] = no
      override def isWarnEnabled: F[Boolean] = no
      override def isErrorEnabled: F[Boolean] = yes
      override def trace(t: Throwable)(msg: => String): F[Unit] = unit
      override def trace(msg: => String): F[Unit] = unit
      override def trace(ctx: Map[String, String])(msg: => String): F[Unit] = unit
      override def trace(ctx: Map[String, String], t: Throwable)(msg: => String): F[Unit] = unit
      override def debug(t: Throwable)(msg: => String): F[Unit] = unit
      override def debug(msg: => String): F[Unit] = unit
      override def debug(ctx: Map[String, String])(msg: => String): F[Unit] = unit
      override def debug(ctx: Map[String, String], t: Throwable)(msg: => String): F[Unit] = unit
      override def info(t: Throwable)(msg: => String): F[Unit] = unit
      override def info(msg: => String): F[Unit] = unit
      override def info(ctx: Map[String, String])(msg: => String): F[Unit] = unit
      override def info(ctx: Map[String, String], t: Throwable)(msg: => String): F[Unit] = unit
      override def warn(t: Throwable)(msg: => String): F[Unit] = unit
      override def warn(msg: => String): F[Unit] = unit
      override def warn(ctx: Map[String, String])(msg: => String): F[Unit] = unit
      override def warn(ctx: Map[String, String], t: Throwable)(msg: => String): F[Unit] = unit
      override def error(t: Throwable)(msg: => String): F[Unit] = ref
        .update(_ :+ CapturedError(msg, Some(t)))
      override def error(msg: => String): F[Unit] = ref.update(_ :+ CapturedError(msg, None))
      override def error(ctx: Map[String, String])(msg: => String): F[Unit] =
        val _ = ctx
        ref.update(_ :+ CapturedError(msg, None))
      override def error(ctx: Map[String, String], t: Throwable)(msg: => String): F[Unit] =
        val _ = ctx
        ref.update(_ :+ CapturedError(msg, Some(t)))
