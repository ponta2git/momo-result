package momo.api.auth

import scala.concurrent.duration.FiniteDuration

import cats.effect.syntax.all.*
import cats.effect.{Async, Ref}
import cats.syntax.all.*
import org.slf4j.LoggerFactory

/** Keeps a bounded local limit when the shared limiter is temporarily unavailable. */
final class ResilientRateLimiter[F[_]: Async] private (
    primary: RateLimiter[F],
    localFallback: RateLimiter[F],
    primaryTimeout: FiniteDuration,
    scope: String,
    degraded: Ref[F, Boolean],
) extends RateLimiter[F]:
  import ResilientRateLimiter.PrimaryResult

  private val logger = LoggerFactory.getLogger("momo.api.auth.ResilientRateLimiter")

  override def allow(key: String): F[Boolean] = primary.allow(key).attempt.map {
    case Right(allowed) => PrimaryResult.Available(allowed)
    case Left(_) => PrimaryResult.Unavailable("error")
  }.timeoutTo(
    primaryTimeout,
    PrimaryResult.Unavailable("timeout").pure[F],
  ).flatMap {
    case PrimaryResult.Available(allowed) => markRecovered.as(allowed)
    case PrimaryResult.Unavailable(reason) => markDegraded(reason) *> localFallback.allow(key)
  }

  private def markDegraded(reason: String): F[Unit] = degraded.getAndSet(true).flatMap {
    case true => Async[F].unit
    case false => Async[F].delay(logger.warn(
        s"rate_limiter_degraded scope=$scope fallback=local reason=$reason"
      ))
  }

  private def markRecovered: F[Unit] = degraded.getAndSet(false).flatMap {
    case false => Async[F].unit
    case true => Async[F].delay(logger.info(s"rate_limiter_recovered scope=$scope"))
  }

object ResilientRateLimiter:
  private enum PrimaryResult:
    case Available(allowed: Boolean)
    case Unavailable(reason: String)

  def create[F[_]: Async](
      primary: RateLimiter[F],
      localFallback: RateLimiter[F],
      primaryTimeout: FiniteDuration,
      scope: String,
  ): F[ResilientRateLimiter[F]] =
    val valid = primaryTimeout.length > 0L && scope.nonEmpty &&
      scope.forall(character => character.isLetterOrDigit || character == '-')
    if valid then
      Ref.of[F, Boolean](false)
        .map(new ResilientRateLimiter(primary, localFallback, primaryTimeout, scope, _))
    else
      Async[F].raiseError(new IllegalArgumentException(
        "ResilientRateLimiter requires a positive timeout and a safe non-empty scope"
      ))
