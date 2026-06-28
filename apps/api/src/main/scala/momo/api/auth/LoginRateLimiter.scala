package momo.api.auth

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

final class LoginRateLimiter[F[_]: Sync] private (
    ref: Ref[F, Map[String, LoginRateLimiter.Bucket]],
    maxPerMinute: Int,
    now: F[Instant],
    retainWindows: Long,
) extends RateLimiter[F]:
  def allow(key: String): F[Boolean] =
    for
      current <- now
      allowed <- ref.modify { buckets =>
        val minute = current.getEpochSecond / 60
        val retained = buckets.filter { case (_, bucket) => minute - bucket.minute < retainWindows }
        val bucket = retained.getOrElse(key, LoginRateLimiter.Bucket(minute, 0))
        val next =
          if bucket.minute == minute then bucket.copy(count = bucket.count + 1)
          else LoginRateLimiter.Bucket(minute, 1)
        val limited = next.count > maxPerMinute
        (retained.updated(key, next), !limited)
      }
    yield allowed

  private[auth] def bucketCount: F[Int] = ref.get.map(_.size)

object LoginRateLimiter:
  final case class Bucket(minute: Long, count: Int)

  def create[F[_]: Sync](maxPerMinute: Int, now: F[Instant]): F[LoginRateLimiter[F]] = Ref
    .of[F, Map[String, Bucket]](Map.empty).map(LoginRateLimiter(_, maxPerMinute, now, 2L))
