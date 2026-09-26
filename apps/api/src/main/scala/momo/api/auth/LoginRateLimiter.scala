package momo.api.auth

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

/** Fixed-window local limiter with bounded key cardinality and constant-time window expiry. */
final class LoginRateLimiter[F[_]: Sync] private (
    ref: Ref[F, LoginRateLimiter.Window],
    maxPerMinute: Int,
    now: F[Instant],
    maxKeys: Int,
) extends RateLimiter[F]:
  def allow(key: String): F[Boolean] = now.flatMap { current =>
    ref.modify { previous =>
      val minute = Math.floorDiv(current.getEpochSecond, 60L)
      // Clock correction must not reopen exhausted buckets. A later minute expires the whole
      // window once, instead of rebuilding the key map for every request.
      val window =
        if minute > previous.minute then LoginRateLimiter.Window(minute, Map.empty)
        else previous
      val count = window.counts.getOrElse(key, 0)
      if count >= maxPerMinute || (count == 0 && window.counts.size >= maxKeys) then
        window -> false
      else window.copy(counts = window.counts.updated(key, count + 1)) -> true
    }
  }

  private[auth] def bucketCount: F[Int] = ref.get.map(_.counts.size)

object LoginRateLimiter:
  private final case class Window(minute: Long, counts: Map[String, Int])
  private val DefaultMaxKeys = 10000

  def create[F[_]: Sync](maxPerMinute: Int, now: F[Instant]): F[LoginRateLimiter[F]] =
    create(maxPerMinute, now, DefaultMaxKeys)

  def create[F[_]: Sync](
      maxPerMinute: Int,
      now: F[Instant],
      maxKeys: Int,
  ): F[LoginRateLimiter[F]] =
    if maxPerMinute < 0 || maxKeys <= 0 then
      Sync[F].raiseError(new IllegalArgumentException(
        "LoginRateLimiter requires a non-negative request limit and a positive key limit"
      ))
    else
      Ref.of[F, Window](Window(Long.MinValue, Map.empty))
        .map(LoginRateLimiter(_, maxPerMinute, now, maxKeys))
